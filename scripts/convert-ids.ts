import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';

import 'dotenv/config';

const ROBLOX_KEY = process.env.ROBLOX_KEY;

const ICONS_JSON = path.resolve('src/icon-data.json');

// Tune these to stay within Roblox API limits
const CONCURRENCY = 4; // Max simultaneous API calls
const RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 5000;

interface IconEntry {
	id: string;
	title: string;
	assetId: number;
	uri: string;
	contributors: string;
	converted?: boolean
}

/** Shape returned by GET /v1/assets/{assetId} for a Decal */
interface AssetDetails {
	[key: string]: unknown;
	asset: {
		textureId: number
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch asset details with retry + exponential backoff, same pattern as upload-pngs.ts.
 */
async function fetchAssetDetails(assetId: number, label: string): Promise<AssetDetails> {
	const url = `https://apis.roblox.com/toolbox-service/v2/assets/${assetId}`;

	for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
		try {
			const resp = await axios.get<AssetDetails>(url, {
				headers: { 'x-api-key': ROBLOX_KEY! },
			});

			if (resp.status === 200) return resp.data;

			// This shouldn't happen with axios (non-2xx throws), but guard anyway
			throw new Error(`HTTP ${resp.status}`);
		} catch (err) {
			const status = (err as { response?: { status?: number } })?.response?.status;
			const isRetryable = status === 429 || (status !== undefined && status >= 500);

			if (!isRetryable || attempt === RETRY_ATTEMPTS) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`[${label}] Failed after ${attempt + 1} attempts: ${message}`);
			}

			const retryAfter = (err as { response?: { headers?: Record<string, string> } })?.response?.headers?.['retry-after'];
			const backoff = retryAfter
				? parseFloat(retryAfter) * 1000
				: RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;

			console.warn(
				`   [${label}] HTTP ${status} — retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
			);
			await sleep(backoff);
		}
	}

	throw new Error(`[${label}] Exceeded retry attempts`);
}

/**
 * Runs tasks from a list with a fixed concurrency ceiling, firing the next
 * task as soon as a slot opens (true pooling, not batch-and-wait).
 * Adapted from upload-pngs.ts.
 */
async function runWithConcurrency<T>(
	items: T[],
	task: (item: T) => Promise<void>,
	concurrency: number,
): Promise<void> {
	let nextIndex = 0;
	let completed = 0;
	const total = items.length;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			await task(items[index]);
			completed++;
			console.log(`Progress: ${completed}/${total} (${total - completed} remaining)`);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);
}

async function main() {
	if (!ROBLOX_KEY) {
		console.error('ROBLOX_KEY not set in .env');
		process.exit(1);
	}

	if (!fs.existsSync(ICONS_JSON)) {
		console.error(`${ICONS_JSON} not found. Run upload-pngs first.`);
		process.exit(1);
	}

	const raw = fs.readFileSync(ICONS_JSON, 'utf-8');
	const icons = JSON.parse(raw) as IconEntry[];

	console.log(`📋 Found ${icons.length} icons to convert.\n`);

	let converted = 0;
	let skipped = 0;
	const errors: string[] = [];

	await runWithConcurrency(
		icons.filter((icon) => icon.assetId !== 0),
		async (icon) => {
			console.log(`Converting ${icon.id} (decal assetId: ${icon.assetId})...`);

			try {

				if (icon.converted) {
					console.log(`   → [SKIPPED] Already converted: ${icon.id}`);
					return;
				}

				const details = await fetchAssetDetails(icon.assetId, icon.id);
				const imageId = details.asset?.textureId;

				if (imageId) {
					icon.assetId = imageId;
					icon.uri = `rbxassetid://${imageId}`;
					icon.converted = true;
					console.log(`   → imageId: ${imageId} (${icon.uri})`);
					converted++;
				} else {
					console.warn(`   ⚠ No imageId found in asset details — keeping decal assetId`);
					skipped++;
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);

				if (message.includes('404')) { 
					icon.converted = true;
					console.log(`   → [SKIPPED] Asset already converted: ${icon.id}`);
					return
				}
				console.error(`   ❌ ${icon.id}: ${message}`);
				errors.push(icon.id);
			}
		},
		CONCURRENCY,
	);

	// Write back updated data
	fs.writeFileSync(ICONS_JSON, JSON.stringify(icons, null, '\t'), 'utf-8');

	console.log(`\n✅ Conversion complete!`);
	console.log(`   Converted: ${converted}`);
	console.log(`   Skipped (no imageId): ${skipped}`);
	if (errors.length > 0) {
		console.log(`   Errors: ${errors.length} (${errors.join(', ')})`);
	}
	console.log(`   Updated: ${ICONS_JSON}`);
}

void main();
