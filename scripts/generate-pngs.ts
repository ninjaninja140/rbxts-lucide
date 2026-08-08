import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { optimize } from 'svgo';

const tagBlacklist: string[] = ['alcohol', 'brewery', 'beer', 'cannabis', 'bomb', 'explosive', 'smoking'];
const iconBlacklist: string[] = ['cannabis', 'cannabis-off', 'bomb', 'qr-code', 'scan-qr-code', 'scan-square', 'barcode'];

const concurrencyLimit = 32;
const args = process.argv.slice(2);

const inputDir = args[0];
const outputDir = args[1];

console.log(`Converting SVGs from: ${inputDir}`);
console.log(`Output directory: ${outputDir}`);

const toCamelCase = <T extends string>(string: T) =>
	string.replace(/^([A-Z])|[\s-_]+(\w)/g, (_match, p1, p2) => (p2 ? p2.toUpperCase() : p1.toLowerCase()));

const toPascalCase = <T extends string>(string: T) => {
	const camelCase = toCamelCase(string);

	return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
};

async function convertSvgToPng(svgPath: string, outputPath: string) {
	const fileInfo = path.parse(svgPath);
	const attributes = JSON.parse(fs.readFileSync(path.join(inputDir, `${fileInfo.name}.json`), 'utf-8'));
	const contributors = attributes.contributors as string[];
	const tags = attributes.tags as string[];

	if (tagBlacklist.some((tag) => tags.includes(tag))) return false;
	if (iconBlacklist.includes(fileInfo.name)) return false;

	const componentName = toPascalCase(fileInfo.name);
	const optimized = optimize(fs.readFileSync(svgPath, 'utf-8'), {
		multipass: true,
		plugins: ['preset-default', 'removeDimensions', 'removeXMLNS'],
	}).data.replaceAll('currentColor', '#FFFFFF');

	await sharp(Buffer.from(optimized))
		.resize(4000, 4000, {
			fit: 'contain',
			background: { r: 255, g: 255, b: 255, alpha: 1 },
		})
		.png({
			quality: 90,
			compressionLevel: 9,
			effort: 10,
		})
		.toFile(outputPath);

	fs.writeFileSync(
		path.join(outputDir, `${fileInfo.name}.json`),
		JSON.stringify({
			id: fileInfo.name,
			title: componentName,
			contributors: contributors.join(', '),
		})
	);

	return true;
}

(async () => {
	try {
		fs.accessSync(outputDir);
	} catch {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const files = fs.readdirSync(inputDir);
	const svgFiles = files.filter((file) => file.toLowerCase().endsWith('.svg'));

	if (svgFiles.length === 0) {
		console.log('No SVG files found in the input directory.');
		process.exit(0);
	}


	const newFiles = svgFiles.filter((file) => {
		const pngName = `${path.basename(file, '.svg')}.png`;
		return !fs.existsSync(path.join(outputDir, pngName));
	});
	const skippedExisting = svgFiles.length - newFiles.length;
	if (skippedExisting > 0) console.log(`Skipping ${skippedExisting} already-converted icons.`);

	if (newFiles.length === 0) {
		console.log('All SVGs already converted. Nothing to do.');
	} else {
		console.log(`Found ${newFiles.length} new SVGs to convert. Starting conversion...\n`);
	}

	const results: Array<{ file: string; success: boolean; error?: string }> = [];
	const totalFiles = newFiles.length;
	let processedCount = 0;


	for (let i = 0; i < newFiles.length; i += concurrencyLimit) {
		const batch = newFiles.slice(i, i + concurrencyLimit);

		const batchPromises = batch.map(async (file) => {
			const inputPath = path.join(inputDir, file);
			const outputFilename = `${path.basename(file, '.svg')}.png`;
			const outputPath = path.join(outputDir, outputFilename);

			try {
				const success = await convertSvgToPng(inputPath, outputPath);
				if (success) return { file, success: true };
				else return { file, success: false };
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`Error converting ${file}:`, errorMessage);
				return { file, success: false, error: errorMessage };
			}
		});

		const batchResults = await Promise.all(batchPromises);
		results.push(...batchResults);

		processedCount += batch.length;
		console.log(`Progress: ${processedCount}/${totalFiles} completed (${totalFiles - processedCount} remaining)`);
	}


	const successful = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	console.log(`\nConversion complete!`);
	console.log(`Successful: ${successful}`);
	console.log(`Failed: ${failed}`);
	console.log(`Skipped (already present): ${skippedExisting}`);
	console.log(`Output directory: ${outputDir}`);
	console.log(`\nGenerating src/icon-data.json...`);

	const iconsJsonPath = path.resolve("src/icon-data.json");

	const merged = new Map<
		string,
		{ id: string; title: string; libraryId?: number; assetId: number; uri: string; contributors: string }
	>();

	if (fs.existsSync(iconsJsonPath)) {
		const existing = JSON.parse(fs.readFileSync(iconsJsonPath, "utf-8")) as Array<{
			id: string;
			title: string;
			libraryId?: number;
			assetId: number;
			uri: string;
			contributors: string;
		}>;
		for (const entry of existing) {
			merged.set(entry.id, { ...entry });
		}
		console.log(`Found existing icon-data.json with ${merged.size} entries.`);
	} else {
		console.log("No existing icon-data.json found — creating fresh.");
	}

	const jsonFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith(".json"));

	let added = 0;
	let preserved = 0;

	for (const jsonFile of jsonFiles) {
		const data = JSON.parse(fs.readFileSync(path.join(outputDir, jsonFile), "utf-8"));
		const id = data.id as string;
		const prev = merged.get(id);

		if (prev?.libraryId) {
			preserved++;
			continue;
		}

		merged.set(id, {
			id,
			title: data.title as string,
			libraryId: prev?.libraryId,
			assetId: prev?.assetId ?? 0,
			uri: prev?.uri ?? "",
			contributors: data.contributors as string,
		});
		added++;
	}

	const sorted = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));

	const cleaned = sorted.map((e) => {
		const entry: Record<string, unknown> = {
			id: e.id,
			title: e.title,
			assetId: e.assetId,
			uri: e.uri,
			contributors: e.contributors,
		};
		if (e.libraryId) entry.libraryId = e.libraryId;
		return entry;
	});

	fs.writeFileSync(iconsJsonPath, JSON.stringify(cleaned, null, "\t"), "utf-8");
	console.log(`Wrote ${cleaned.length} entries (${added} new/updated, ${preserved} unchanged with libraryId) to ${iconsJsonPath}`);
})();
