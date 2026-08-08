import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { optimize } from "svgo";
import { smartInvert } from "./smart-invert";

const LUCIDE_ICONS_DIR = path.resolve("lucide/icons");
const IMG_SOLID_DIR = path.resolve("img-solid");
const IMG_DIR = path.resolve("img");
const CONCURRENCY = 32;

const tagBlacklist: string[] = ["alcohol", "brewery", "beer", "cannabis", "bomb", "explosive", "smoking"];
const iconBlacklist: string[] = ["cannabis", "cannabis-off", "bomb", "qr-code", "scan-qr-code", "scan-square"];

const toPascalCase = (s: string): string =>
	s.replace(/^([A-Z])|[\s-_]+(\w)/g, (_m, p1, p2) => (p2 ? p2.toUpperCase() : p1.toLowerCase()))
	 .replace(/^./, (c) => c.toUpperCase());

function isBlacklisted(name: string): boolean {
	if (iconBlacklist.includes(name)) return true;

	const jsonPath = path.join(LUCIDE_ICONS_DIR, `${name}.json`);
	if (fs.existsSync(jsonPath)) {
		const attributes = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
		const tags = attributes.tags as string[];
		if (tagBlacklist.some((tag) => tags.includes(tag))) return true;
	}

	return false;
}

function phase1(): string[] {
	console.log("=== Phase 1: Inverting SVGs → img-solid/ ===\n");

	fs.mkdirSync(IMG_SOLID_DIR, { recursive: true });

	const files = fs.readdirSync(LUCIDE_ICONS_DIR).filter((f) => f.toLowerCase().endsWith(".svg"));
	console.log(`Found ${files.length} SVGs in ${LUCIDE_ICONS_DIR}`);

	let ok = 0;
	let fail = 0;
	let skipped = 0;
	let alreadyPresent = 0;

	for (const file of files) {
		const name = path.basename(file, ".svg");
		const outputPath = path.join(IMG_SOLID_DIR, `${name}-fill.svg`);

		if (isBlacklisted(name)) {
			skipped++;
			continue;
		}

		if (fs.existsSync(outputPath)) {
			alreadyPresent++;
			continue;
		}

		const inputPath = path.join(LUCIDE_ICONS_DIR, file);

		try {
			const svgString = fs.readFileSync(inputPath, "utf-8");
			const result = smartInvert(svgString);
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(outputPath, result, "utf-8");
			ok++;
		} catch (err) {
			console.error(`  FAILED invert: ${file} — ${(err as Error).message}`);
			fail++;
		}
	}

	console.log(`Phase 1 done: ${ok} ok, ${fail} failed, ${skipped} skipped, ${alreadyPresent} already present\n`);
	return files.map((f) => path.basename(f, ".svg"));
}

async function convertSvgToPng(
	name: string,
	solidSvgPath: string,
	originalJsonPath: string,
	outputPngPath: string,
	outputJsonPath: string,
): Promise<boolean> {
	if (isBlacklisted(name)) return false;

	const attributes = JSON.parse(fs.readFileSync(originalJsonPath, "utf-8"));
	const contributors = attributes.contributors as string[];
	const componentName = toPascalCase(name + "-fill");

	const optimized = optimize(fs.readFileSync(solidSvgPath, "utf-8"), {
		multipass: true,
		plugins: ["preset-default", "removeDimensions", "removeXMLNS"],
	}).data.replaceAll("currentColor", "#FFFFFF");

	await sharp(Buffer.from(optimized))
		.resize(4000, 4000, {
			fit: "contain",
			background: { r: 255, g: 255, b: 255, alpha: 1 },
		})
		.png({
			quality: 90,
			compressionLevel: 9,
			effort: 10,
		})
		.toFile(outputPngPath);

	fs.writeFileSync(
		outputJsonPath,
		JSON.stringify({
			id: `${name}-fill`,
			title: componentName,
			contributors: contributors.join(", "),
		}),
	);

	return true;
}

async function phase2(iconNames: string[]) {
	console.log("\n=== Phase 2: Rasterizing fills → img/ ===\n");

	fs.mkdirSync(IMG_DIR, { recursive: true });

	const solidFiles = fs.readdirSync(IMG_SOLID_DIR).filter((f) => f.endsWith("-fill.svg"));
	const newSolidFiles = solidFiles.filter((f) => {
		const fillBase = path.basename(f, ".svg");
		return !fs.existsSync(path.join(IMG_DIR, `${fillBase}.png`)) || !fs.existsSync(path.join(IMG_DIR, `${fillBase}.json`));
	});
	const alreadyPresent = solidFiles.length - newSolidFiles.length;
	if (alreadyPresent > 0) console.log(`Skipping ${alreadyPresent} already-rasterized fills.`);
	console.log(`Found ${solidFiles.length} solid SVGs in ${IMG_SOLID_DIR}, ${newSolidFiles.length} to process`);

	const results: Array<{ name: string; success: boolean; error?: string }> = [];
	const totalFiles = newSolidFiles.length;
	let processedCount = 0;

	for (let i = 0; i < newSolidFiles.length; i += CONCURRENCY) {
		const batch = newSolidFiles.slice(i, i + CONCURRENCY);

		const batchPromises = batch.map(async (file) => {
			const fillBase = path.basename(file, ".svg");
			const name = fillBase.replace(/-fill$/, "");

			const solidSvgPath = path.join(IMG_SOLID_DIR, file);
			const originalJsonPath = path.join(LUCIDE_ICONS_DIR, `${name}.json`);
			const outputPngPath = path.join(IMG_DIR, `${fillBase}.png`);
			const outputJsonPath = path.join(IMG_DIR, `${fillBase}.json`);

			if (!fs.existsSync(originalJsonPath)) {
				console.error(`  Missing JSON for ${name} — skipping`);
				return { name: fillBase, success: false, error: "Missing source JSON" };
			}

			try {
				const success = await convertSvgToPng(
					name,
					solidSvgPath,
					originalJsonPath,
					outputPngPath,
					outputJsonPath,
				);

				return { name: fillBase, success };
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`  Error converting ${file}:`, errorMessage);
				return { name: fillBase, success: false, error: errorMessage };
			}
		});

		const batchResults = await Promise.all(batchPromises);
		results.push(...batchResults);

		processedCount += batch.length;
		console.log(
			`Progress: ${processedCount}/${totalFiles} (${totalFiles - processedCount} remaining)`,
		);
	}

	const successful = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;

	console.log(`\nPhase 2 done: ${successful} ok, ${failed} failed, ${alreadyPresent} already present\n`);
	return results.filter((r) => r.success).map((r) => r.name);
}

function generateIconData() {
	console.log("Merging fill entries into src/icon-data.json...\n");

	const iconDataPath = path.resolve("src/icon-data.json");

	const merged = new Map<
		string,
		{ id: string; title: string; libraryId?: number; assetId: number; uri: string; contributors: string }
	>();

	if (fs.existsSync(iconDataPath)) {
		const existing = JSON.parse(fs.readFileSync(iconDataPath, "utf-8")) as Array<{
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

	const jsonFiles = fs.readdirSync(IMG_DIR).filter((f) => f.endsWith("-fill.json"));

	let added = 0;
	let preserved = 0;

	for (const jsonFile of jsonFiles) {
		const data = JSON.parse(
			fs.readFileSync(path.join(IMG_DIR, jsonFile), "utf-8"),
		);
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

	fs.writeFileSync(iconDataPath, JSON.stringify(cleaned, null, "\t"), "utf-8");
	console.log(`Wrote ${cleaned.length} entries (${added} new/updated, ${preserved} unchanged with libraryId) to ${iconDataPath}`);
}

(async () => {
	console.log("generate-fills.ts — Solid icon pipeline\n");

	const iconNames = phase1();

	await phase2(iconNames);
	generateIconData();

	console.log("\nConverted all icons to filled variants");
})();
