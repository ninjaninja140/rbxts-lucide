import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';

import 'dotenv/config';

const ROBLOX_KEY = process.env.ROBLOX_KEY;
const ICONS_JSON = path.resolve('src/icon-data.json');
const CONCURRENCY = 150;
const RETRY_ATTEMPTS = 30;
const RETRY_BASE_DELAY_MS = 500;

class AccountLockedError extends Error {
	constructor(context: string) {
		super(`ACCOUNT LOCKED: Roblox returned 403 at "${context}". The account cannot be used. Stopping immediately.`);
		this.name = "AccountLockedError";
	}
}

interface IconEntry {
	libraryId: number;
	id: string;
	title: string;
	assetId: number;
	uri: string;
	contributors: string;
}

interface AssetDetails {
	[key: string]: unknown;
	asset: {
		textureId: number
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAssetDetails(libraryId: number, label: string): Promise<AssetDetails> {
	const url = `https://apis.roblox.com/toolbox-service/v2/assets/${libraryId}`;

	for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
		try {
			const resp = await axios.get<AssetDetails>(url, {
				headers: { 'x-api-key': ROBLOX_KEY! },
			});

			if (resp.status === 200) return resp.data;
			throw new Error(`HTTP ${resp.status}`);
		} catch (err) {
			const status = (err as { response?: { status?: number } })?.response?.status;

			if (status === 403) throw new AccountLockedError(label);
			if (status === 429) {
				if (attempt === RETRY_ATTEMPTS) {
					const message = err instanceof Error ? err.message : String(err);
					throw new Error(`[${label}] HTTP 429 after ${RETRY_ATTEMPTS} retries: ${message}`);
				}
				const retryAfterHeader = (err as { response?: { headers?: Record<string, string> } })?.response?.headers?.['retry-after'];
				const waitMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : 60_000;
				console.warn(
					`   [${label}] HTTP 429 — waiting ${Math.round(waitMs)}ms for bucket reset (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
				);
				await sleep(waitMs);
				continue;
			}

			if (status && status >= 500 && attempt < RETRY_ATTEMPTS) {
				const backoff = RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
				console.warn(
					`   [${label}] HTTP ${status} — retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
				);
				await sleep(backoff);
				continue;
			}

			const message = err instanceof Error ? err.message : String(err);
			throw new Error(`[${label}] Failed after ${attempt + 1} attempts: ${message}`);
		}
	}

	throw new Error(`[${label}] Exceeded retry attempts`);
}

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

	console.log(`Found ${icons.length} icons to convert.\n`);

	let converted = 0;
	let skipped = 0;
	const errors: string[] = [];

	await runWithConcurrency(
		icons.filter((icon) => icon.assetId === 0 && icon.libraryId && icon.uri === ''),
		async (icon) => {
			console.log(`Converting ${icon.id} (decal assetId: ${icon.libraryId})...`);

			try {
				if (icon.assetId !== 0 || icon.uri !== '') {
					console.log(`   → [SKIPPED] Already converted: ${icon.id}`);
					return;
				}

				const details = await fetchAssetDetails(icon.libraryId, icon.id);
				const imageId = details.asset?.textureId;

				if (imageId) {
					icon.assetId = imageId;
					icon.uri = `rbxassetid://${imageId}`;
					console.log(`   → imageId: ${imageId} (${icon.uri})`);
					converted++;
				} else {
					console.warn(`   ⚠ No imageId found in asset details — keeping decal assetId`);
					skipped++;
				}
			} catch (err) {
				if (err instanceof AccountLockedError) throw err;

				const message = err instanceof Error ? err.message : String(err);

				if (message.includes('404')) {
					console.log(`   → [SKIPPED] Asset had error: ${icon.id}`);
					skipped++;
					return
				}

				console.error(`   ${icon.id}: ${message}`);
				errors.push(icon.id);
			}
		},
		CONCURRENCY,
	);

	fs.writeFileSync(ICONS_JSON, JSON.stringify(icons, null, '\t'), 'utf-8');

	console.log(`\nConversion complete!`);
	console.log(`   Converted: ${converted}`);
	console.log(`   Skipped (no imageId): ${skipped}`);
	if (errors.length > 0) console.log(`   Errors: ${errors.length} (${errors.join(', ')})`);
	console.log(`   Updated: ${ICONS_JSON}`);
}

void main().catch((err) => {
	if (err instanceof AccountLockedError) console.error(`\n❌ ${err.message}`);
	else console.error("\nUnexpected error:", err);
	process.exit(1);
});
