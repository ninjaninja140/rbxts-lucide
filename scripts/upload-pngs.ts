import axios from 'axios';
import FormData from 'form-data';
import fs from 'node:fs';
import path from 'node:path';

import 'dotenv/config';

const ROBLOX_KEY = process.env.ROBLOX_KEY;
const ROBLOX_USER_ID = process.env.ROBLOX_USER_ID;
const WEBHOOK_URL = process.env.ROBLOX_WEBHOOK_UPLOAD_ID;

const IMG_DIR = path.resolve('img');
const OUTPUT_JSON = path.resolve('src/icon-data.json');

// Tune these to stay within Roblox API limits
const CONCURRENCY = 2; // Max simultaneous uploads
const BATCH_DELAY_MS = 2000; // Pause between batches (ms)
const RETRY_ATTEMPTS = 5; // Max retries on rate limit / transient errors
const RETRY_BASE_DELAY_MS = 2000; // Base delay for exponential backoff

interface IconMeta {
	id: string;
	title: string;
	contributors: string;
}

interface IconEntry extends IconMeta {
	assetId: number;
	uri: string;
}

interface OperationResult {
	done: boolean;
	response?: {
		assetId?: number;
		[key: string]: unknown;
	};
	error?: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function readIconMeta(jsonPath: string): IconMeta {
	const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

	return {
		id: data.id as string,
		title: data.title as string,
		contributors: data.contributors as string,
	};
}

async function fetchWithRetry(url: string, options: RequestInit, label: string): Promise<Response> {
	for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
		const resp = await fetch(url, options);

		if (resp.ok) return resp;

		// On 429 or 5xx, retry with backoff
		if (resp.status === 429 || resp.status >= 500) {
			if (attempt === RETRY_ATTEMPTS)
				throw new Error(`[${label}] HTTP ${resp.status} after ${RETRY_ATTEMPTS} retries: ${await resp.text()}`);

			// Honour Retry-After header if present, else exponential backoff + jitter
			const retryAfter = resp.headers.get('Retry-After');
			const backoff = retryAfter
				? parseFloat(retryAfter) * 1000
				: RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;

			console.warn(
				`   [${label}] HTTP ${resp.status} — retrying in ${Math.round(backoff)}ms (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`
			);
			await sleep(backoff);
			continue;
		}

		// Non-retryable error — throw immediately
		const text = await resp.text();
		throw new Error(`[${label}] HTTP ${resp.status}: ${text}`);
	}

	// Unreachable, but TypeScript needs a return path
	throw new Error(`[${label}] Exceeded retry attempts`);
}

async function pollOperation(operationId: string): Promise<OperationResult> {
	const maxAttempts = 30;
	const delayMs = 2000;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const resp = await fetchWithRetry(
			`https://apis.roblox.com/assets/v1/operations/${operationId}`,
			{ headers: { 'x-api-key': ROBLOX_KEY! } },
			`poll:${operationId}`
		);

		const result = (await resp.json()) as OperationResult;
		if (result.done) return result;

		await sleep(delayMs);
	}

	throw new Error(`Operation ${operationId} timed out after ${maxAttempts} attempts`);
}

async function uploadToRoblox(pngPath: string, meta: IconMeta): Promise<{ assetId: number; uri: string }> {
	console.log(`Uploading ${meta.id}...`);
	console.log(`   Path: ${pngPath}`);

	const form = new FormData();

	form.append(
		'request',
		JSON.stringify({
			assetType: 'Decal',
			displayName: meta.id,
			description: `Contributors: ${meta.contributors}`,
			creationContext: {
				creator: {
					userId: ROBLOX_USER_ID,
				},
			},
		})
	);

	form.append('fileContent', fs.createReadStream(pngPath));

	const uploadResp = await axios.post('https://apis.roblox.com/assets/v1/assets', form, {
		headers: {
			'x-api-key': ROBLOX_KEY!,
			...form.getHeaders(),
		},
	});

	console.log(`   Upload response: ${JSON.stringify(uploadResp.data)}`);

	const uploadResult = uploadResp.data as { path: string };

	// Response is { "path": "operations/{operationId}" }
	const operationId = uploadResult.path?.split('/').pop();
	if (!operationId)
		throw new Error(`No operationId in upload response for ${meta.id}: ${JSON.stringify(uploadResult)}`);

	console.log(`   Uploaded ${meta.id} (operation: ${operationId})`);

	const opResult = await pollOperation(operationId);

	if (opResult.error) throw new Error(`Asset creation failed for ${meta.id}: ${opResult.error}`);

	console.log(`   Operation result: ${JSON.stringify(opResult)}`);

	await axios.post(WEBHOOK_URL!, {
		content: `Asset created for ${meta.id}: ${opResult.response?.assetId}`,
	});

	// assetId comes back as a string in the API response
	const assetIdStr = opResult.response?.assetId;
	if (!assetIdStr) throw new Error(`No assetId in operation response for ${meta.id}: ${JSON.stringify(opResult)}`);

	const assetId = Number(assetIdStr);
	return { assetId, uri: `rbxassetid://${assetId}` };
}

async function processIcon(jsonPath: string, pngPath: string): Promise<IconEntry> {
	const meta = readIconMeta(jsonPath);
	console.log(`Processing: ${meta.id} (${meta.title})`);

	const { assetId, uri } = await uploadToRoblox(pngPath, meta);

	return {
		id: meta.id,
		title: meta.title,
		assetId,
		uri,
		contributors: meta.contributors,
	};
}

/**
 * Runs tasks from a list with a fixed concurrency ceiling, firing the next
 * task as soon as a slot opens (true pooling, not batch-and-wait).
 */
async function runWithConcurrency<T>(
	items: string[],
	task: (item: string) => Promise<T | null>,
	concurrency: number,
	total: number
): Promise<(T | null)[]> {
	const results: (T | null)[] = new Array(items.length).fill(null);
	let nextIndex = 0;
	let completed = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await task(items[index]);
			completed++;
			console.log(`Progress: ${completed}/${total} (${total - completed} remaining)`);
		}
	}

	await Promise.all(Array.from({ length: concurrency }, worker));
	return results;
}

async function main() {
	console.log('Starting Roblox icon upload...\n');
	console.log(`Settings: concurrency=${CONCURRENCY}, batchDelay=${BATCH_DELAY_MS}ms, retries=${RETRY_ATTEMPTS}\n`);

	const files = fs.readdirSync(IMG_DIR);
	const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();

	if (jsonFiles.length === 0) {
		console.log('No JSON files found in img/. Run generate-pngs first.');
		process.exit(1);
	}

	// Load existing icons.json to skip already-uploaded icons
	const existingMap = new Map<string, IconEntry>();
	if (fs.existsSync(OUTPUT_JSON)) {
		const existing = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf-8')) as IconEntry[];
		for (const entry of existing) if (entry.assetId > 0) existingMap.set(entry.id, entry);
		if (existingMap.size > 0)
			console.log(`Found ${existingMap.size} already-uploaded icons. They will be skipped.\n`);
	}

	const newJsonFiles = jsonFiles.filter((f) => !existingMap.has(path.basename(f, '.json')));

	const skippedCount = jsonFiles.length - newJsonFiles.length;
	if (skippedCount > 0) console.log(`Skipping ${skippedCount} already-uploaded icons.`);
	console.log(`Found ${newJsonFiles.length} new icons to upload.\n`);

	if (newJsonFiles.length === 0) {
		console.log('No new icons to upload. Everything is up to date.');
		process.exit(0);
	}

	const results = await runWithConcurrency<IconEntry>(
		newJsonFiles,
		async (jsonFile) => {
			const iconId = path.basename(jsonFile, '.json');
			const jsonPath = path.join(IMG_DIR, jsonFile);
			const pngPath = path.join(IMG_DIR, `${iconId}.png`);

			if (!fs.existsSync(pngPath)) {
				console.warn(`   PNG not found for ${iconId}, skipping.`);
				return null;
			}

			try {
				// Small per-task jitter to avoid thundering-herd on startup
				await sleep(Math.random() * 500);
				return await processIcon(jsonPath, pngPath);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`   Error processing ${iconId}: ${msg}`);
				return null;
			}
		},
		CONCURRENCY,
		newJsonFiles.length
	);

	// Brief cooldown after all uploads before writing results
	await sleep(BATCH_DELAY_MS);

	// Merge new results with existing entries
	const merged = new Map<string, IconEntry>(existingMap);
	for (const entry of results) if (entry) merged.set(entry.id, entry);

	// Preserve any stale entries from the existing file
	if (fs.existsSync(OUTPUT_JSON)) {
		const existing = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf-8')) as IconEntry[];
		for (const entry of existing) if (!merged.has(entry.id)) merged.set(entry.id, entry);
	}

	const finalEntries = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));

	fs.writeFileSync(OUTPUT_JSON, JSON.stringify(finalEntries, null, '\t'), 'utf-8');
	console.log(`\nSaved ${finalEntries.length} icons to ${OUTPUT_JSON}`);

	const successCount = results.filter(Boolean).length;
	console.log(`${successCount} uploaded, ${newJsonFiles.length - successCount} failed.`);
}

void main();
