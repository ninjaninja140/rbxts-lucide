import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { optimize } from 'svgo';

const tagBlacklist: string[] = ['alcohol', 'brewery', 'beer', 'cannabis', 'bomb', 'explosive', 'smoking'];
const iconBlacklist: string[] = ['cannabis', 'cannabis-off', 'bomb', 'qr-code', 'scan-qr-code'];

const concurrencyLimit = 32; // how many we are gonna run at once
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

	console.log(`Found ${svgFiles.length} SVG files. Starting conversion...\n`);

	const results: Array<{ file: string; success: boolean; error?: string }> = [];
	const totalFiles = svgFiles.length;
	let processedCount = 0;

	// Process in batches to avoid memory issues
	for (let i = 0; i < svgFiles.length; i += concurrencyLimit) {
		const batch = svgFiles.slice(i, i + concurrencyLimit);

		const batchPromises = batch.map(async (file) => {
			const inputPath = path.join(inputDir, file);
			const outputFilename = `${path.basename(file, '.svg')}.png`;
			const outputPath = path.join(outputDir, outputFilename);

			try {
				const success = await convertSvgToPng(inputPath, outputPath);
				if (success) return { file, success: true };
				else {
					return { file, success: false };
				}
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

	// Report results
	const successful = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	console.log(`\nConversion complete!`);
	console.log(`Successful: ${successful}`);
	console.log(`Failed: ${failed}`);
	console.log(`Output directory: ${outputDir}`);

	// Generate / update icon-data.json for the package with placeholder asset IDs
	// Real asset IDs are filled in by scripts/upload-pngs.ts
	console.log(`\nGenerating src/icon-data.json...`);
	const iconsJsonPath = path.resolve('src/icon-data.json');

	// Load existing icon-data.json if it exists, so we preserve assetId/uri from prior runs
	let existingMap = new Map<string, { assetId: number; uri: string }>();
	if (fs.existsSync(iconsJsonPath)) {
		const existing: Array<{ id: string; assetId: number; uri: string }> = JSON.parse(
			fs.readFileSync(iconsJsonPath, 'utf-8')
		);
		for (const entry of existing) {
			existingMap.set(entry.id, { assetId: entry.assetId, uri: entry.uri });
		}
		console.log(`Found existing icon-data.json with ${existing.length} entries — will merge.`);
	} else {
		console.log('No existing icon-data.json found — creating fresh.');
	}

	const jsonFiles = fs.readdirSync(outputDir).filter((f) => f.endsWith('.json'));
	const iconsData: Array<{ id: string; title: string; assetId: number; uri: string; contributors: string }> = [];

	for (const jsonFile of jsonFiles) {
		const data = JSON.parse(fs.readFileSync(path.join(outputDir, jsonFile), 'utf-8'));
		const existing = existingMap.get(data.id);
		iconsData.push({
			id: data.id as string,
			title: data.title as string,
			assetId: existing?.assetId ?? 0,
			uri: existing?.uri ?? '',
			contributors: data.contributors as string,
		});
	}

	iconsData.sort((a, b) => a.id.localeCompare(b.id));
	fs.writeFileSync(iconsJsonPath, JSON.stringify(iconsData, null, '\t'), 'utf-8');
	console.log(`Wrote ${iconsData.length} entries to ${iconsJsonPath}`);
})();
