import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";

import "dotenv/config";

const ROBLOX_KEY = process.env.ROBLOX_KEY;
const ROBLOX_USER_ID = process.env.ROBLOX_USER_ID;
const WEBHOOK_URL = process.env.ROBLOX_WEBHOOK_UPLOAD_ID;

const IMG_DIR = path.resolve("img");
const OUTPUT_JSON = path.resolve("src/icon-data.json");

const CONCURRENCY = 10;
const RETRY_ATTEMPTS = 10;
const MAX_POLL_ATTEMPTS = 30;
const POLL_DELAY_MS = 2000;
const DEFAULT_RETRY_AFTER_MS = 60_000;

const SEP = "─".repeat(50);

class AccountLockedError extends Error {
	constructor(context: string) {
		super(
			`ACCOUNT LOCKED: Roblox returned 403 at "${context}". The account cannot upload. Stopping immediately.`,
		);
		this.name = "AccountLockedError";
	}
}

interface IconMeta {
	id: string;
	title: string;
	contributors: string;
}

interface IconEntry extends IconMeta {
	libraryId: number;
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
	const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
	return {
		id: data.id as string,
		title: data.title as string,
		contributors: data.contributors as string,
	};
}

function parseRetryAfterMs(headerValue: string | null): number {
	if (!headerValue) return DEFAULT_RETRY_AFTER_MS;
	const parsed = parseFloat(headerValue);
	return Number.isNaN(parsed) ? DEFAULT_RETRY_AFTER_MS : parsed * 1000;
}

async function fetchWithRetry(
	url: string,
	options: RequestInit,
	label: string,
): Promise<Response> {
	for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
		const resp = await fetch(url, options);

		if (resp.ok) return resp;

		if (resp.status === 403) {
			throw new AccountLockedError(label);
		}

		if (resp.status === 429) {
			if (attempt === RETRY_ATTEMPTS) {
				throw new Error(
					`[${label}] HTTP 429 after ${RETRY_ATTEMPTS} retries: ${await resp.text()}`,
				);
			}
		const waitMs = parseRetryAfterMs(resp.headers.get("x-retryafter"));
			console.warn(
				`   ⚠ [${label}] Rate limited — waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
			);
			await sleep(waitMs);
			continue;
		}

		if (resp.status >= 500) {
			if (attempt === RETRY_ATTEMPTS) {
				throw new Error(
					`[${label}] HTTP ${resp.status} after ${RETRY_ATTEMPTS} retries: ${await resp.text()}`,
				);
			}
			const backoff = 2000 * 2 ** attempt + Math.random() * 500;
			console.warn(
				`   ⚠ [${label}] Server error ${resp.status} — retrying in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
			);
			await sleep(backoff);
			continue;
		}

		const text = await resp.text();
		throw new Error(`[${label}] HTTP ${resp.status}: ${text}`);
	}

	throw new Error(`[${label}] Exceeded retry attempts`);
}

async function pollOperation(operationId: string): Promise<OperationResult> {
	for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
		const resp = await fetchWithRetry(
			`https://apis.roblox.com/assets/v1/operations/${operationId}`,
			{ headers: { "x-api-key": ROBLOX_KEY! } },
			`poll:${operationId}`,
		);

		const result = (await resp.json()) as OperationResult;
		if (result.done) return result;

		if (attempt > 0 && attempt % 5 === 0) {
			console.log(`   … waiting for operation ${operationId} (${attempt * POLL_DELAY_MS / 1000}s elapsed)`);
		}
		await sleep(POLL_DELAY_MS);
	}

	throw new Error(
		`Operation ${operationId} timed out after ${MAX_POLL_ATTEMPTS} attempts`,
	);
}

async function uploadToRoblox(
	pngPath: string,
	meta: IconMeta,
): Promise<{ id: number }> {
	const form = new FormData();

	form.append(
		"request",
		JSON.stringify({
			assetType: "Decal",
			displayName: meta.id,
			description: `Contributors: ${meta.contributors}`,
			creationContext: {
				creator: {
					userId: ROBLOX_USER_ID,
				},
			},
		}),
	);

	form.append("fileContent", fs.createReadStream(pngPath));

	const axiosError = (
		err: unknown,
	): { status?: number; headers?: Record<string, string> } => {
		const r = (err as { response?: { status?: number; headers?: Record<string, string> } }).response;
		return r ?? {};
	};

	let uploadRespData: unknown;
	for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
		try {
			const resp = await axios.post(
				"https://apis.roblox.com/assets/v1/assets",
				form,
				{
					headers: {
						"x-api-key": ROBLOX_KEY!,
						...form.getHeaders(),
					},
				},
			);
			uploadRespData = resp.data;
			break;
		} catch (err) {
			const { status, headers } = axiosError(err);

			if (status === 403) throw new AccountLockedError(`upload:${meta.id}`);

			if (status === 429) {
				if (attempt === RETRY_ATTEMPTS) {
					const msg = err instanceof Error ? err.message : String(err);
					throw new Error(
						`[upload:${meta.id}] HTTP 429 after ${RETRY_ATTEMPTS} retries: ${msg}`,
					);
				}
			const waitMs = parseRetryAfterMs(headers?.["x-retryafter"] ?? null);
				console.warn(
					`   ⚠ [${meta.id}] Rate limited — waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
				);
				await sleep(waitMs);
				continue;
			}

			if (attempt === RETRY_ATTEMPTS || (status && status < 500)) {
				const msg = err instanceof Error ? err.message : String(err);
				throw new Error(
					`[${meta.id}] Failed after ${attempt + 1} attempts: ${msg}`,
				);
			}
			const backoff = 2000 * 2 ** attempt + Math.random() * 500;
			console.warn(
				`   ⚠ [${meta.id}] HTTP ${status ?? "error"} — retrying in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${RETRY_ATTEMPTS})`,
			);
			await sleep(backoff);
		}
	}

	const uploadResult = uploadRespData! as { path: string };

	const operationId = uploadResult.path?.split("/").pop();
	if (!operationId) {
		throw new Error(
			`No operationId in upload response for ${meta.id}: ${JSON.stringify(uploadResult)}`,
		);
	}

	console.log(`   ✓ uploaded (operation: ${operationId})`);

	const opResult = await pollOperation(operationId);

	if (opResult.error) {
		throw new Error(
			`Asset creation failed for ${meta.id}: ${opResult.error}`,
		);
	}

	const assetIdStr = opResult.response?.assetId;
	if (!assetIdStr) {
		throw new Error(
			`No assetId in operation response for ${meta.id}: ${JSON.stringify(opResult)}`,
		);
	}

	await axios.post(WEBHOOK_URL!, {
		content: `Asset created for ${meta.id}: ${opResult.response?.assetId}`,
	});

	return { id: Number(assetIdStr) };
}

async function processIcon(
	jsonPath: string,
	pngPath: string,
): Promise<IconEntry> {
	const meta = readIconMeta(jsonPath);
	const { id } = await uploadToRoblox(pngPath, meta);

	return {
		libraryId: id,
		id: meta.id,
		title: meta.title,
		assetId: 0,
		uri: "",
		contributors: meta.contributors,
	};
}

async function runWithConcurrency<T>(
	items: string[],
	task: (item: string) => Promise<T | null>,
	concurrency: number,
	total: number,
): Promise<(T | null)[]> {
	const results: (T | null)[] = new Array(items.length).fill(null);
	let nextIndex = 0;
	let completed = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await task(items[index]);
			completed++;
			console.log(
				`   Progress: ${completed}/${total} (${total - completed} remaining)`,
			);
		}
	}

	await Promise.all(Array.from({ length: concurrency }, worker));
	return results;
}

async function main() {
	console.log(`\n${SEP}`);
	console.log("   upload-pngs");
	console.log(`${SEP}\n`);

	console.log(`   concurrency:       ${CONCURRENCY}`);
	console.log(`   max retries:       ${RETRY_ATTEMPTS}`);
	console.log(`   operation timeout: ${(MAX_POLL_ATTEMPTS * POLL_DELAY_MS) / 1000}s`);
	console.log();

	const files = fs.readdirSync(IMG_DIR);
	const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();

	if (jsonFiles.length === 0) {
		console.log("   No JSON files found in img/. Run generate-pngs first.");
		process.exit(1);
	}

	const existingMap = new Map<string, IconEntry>();
	if (fs.existsSync(OUTPUT_JSON)) {
		const existing = JSON.parse(
			fs.readFileSync(OUTPUT_JSON, "utf-8"),
		) as IconEntry[];
		for (const entry of existing) if (entry.libraryId) existingMap.set(entry.id, entry);
		
	}

	const newJsonFiles = jsonFiles.filter(
		(f) => !existingMap.has(path.basename(f, ".json")),
	);
	const skippedCount = jsonFiles.length - newJsonFiles.length;

	console.log(`   total in img/:  ${jsonFiles.length}`);
	console.log(`   already done:   ${skippedCount}`);
	console.log(`   to upload:      ${newJsonFiles.length}`);
	console.log(`${SEP}\n`);

	if (newJsonFiles.length === 0) {
		console.log("   Everything is up to date.");
		process.exit(0);
	}

	// Retry loop: keep uploading failed icons until all succeed
	const merged = new Map<string, IconEntry>(existingMap);
	let pendingFiles = [...newJsonFiles];
	let attemptNum = 0;
	let totalPreviouslyUploaded = existingMap.size;

	while (pendingFiles.length > 0) {
		attemptNum++;
		const batchLabel =
			pendingFiles.length === newJsonFiles.length
				? `uploading ${pendingFiles.length} icons`
				: `retrying ${pendingFiles.length} failed icons (attempt #${attemptNum})`;
		console.log(
			`▶  ${batchLabel} (concurrency=${CONCURRENCY})…\n`,
		);

		const results = await runWithConcurrency<IconEntry>(
			pendingFiles,
			async (jsonFile) => {
				const iconId = path.basename(jsonFile, ".json");
				const jsonPath = path.join(IMG_DIR, jsonFile);
				const pngPath = path.join(IMG_DIR, `${iconId}.png`);

				if (!fs.existsSync(pngPath)) {
					console.warn(`   ⚠ ${iconId}: PNG missing, skipping`);
					return null;
				}

				try {
					console.log(`   ↑ ${iconId}`);
					return await processIcon(jsonPath, pngPath);
				} catch (err) {
					if (err instanceof AccountLockedError) throw err;
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`   ✗ ${iconId}: ${msg}`);
					return null;
				}
			},
			CONCURRENCY,
			pendingFiles.length,
		);

		await sleep(500);

		// Collect failures that are worth retrying (PNG must exist)
		const retryFiles: string[] = [];
		let permanentSkips = 0;
		for (let i = 0; i < results.length; i++) {
			const entry = results[i];
			if (entry) {
				merged.set(entry.id, entry);
			} else {
				const jsonFile = pendingFiles[i];
				const iconId = path.basename(jsonFile, ".json");
				const retryPngPath = path.join(IMG_DIR, `${iconId}.png`);
				if (fs.existsSync(retryPngPath)) {
					retryFiles.push(jsonFile);
				} else {
					permanentSkips++;
				}
			}
		}

		// Save progress after each round
		if (fs.existsSync(OUTPUT_JSON)) {
			const existing = JSON.parse(
				fs.readFileSync(OUTPUT_JSON, "utf-8"),
			) as IconEntry[];
			for (const entry of existing) {
				if (!merged.has(entry.id)) merged.set(entry.id, entry);
			}
		}

		const roundEntries = [...merged.values()].sort((a, b) =>
			a.id.localeCompare(b.id),
		);

		fs.writeFileSync(
			OUTPUT_JSON,
			JSON.stringify(roundEntries, null, "\t"),
			"utf-8",
		);

		const roundSuccess = results.filter(Boolean).length;
		const roundFail = retryFiles.length;

		console.log();
		if (roundFail === 0 && permanentSkips === 0) {
			console.log(`   ✓ all ${roundSuccess} succeeded this round`);
		} else {
			console.log(`   ✓ uploaded  ${roundSuccess}`);
			if (roundFail > 0) console.log(`   ✗ failed    ${roundFail} — retrying…`);
			if (permanentSkips > 0)
				console.log(`   ⊝ skipped   ${permanentSkips} (PNG missing, cannot retry)`);
		}

		pendingFiles = retryFiles;

		if (pendingFiles.length === 0 && permanentSkips > 0) {
			console.log(
				`\n   ⚠ ${permanentSkips} icon(s) could not be uploaded because their PNG files are missing.`,
			);
		}
	}

	const finalEntries = [...merged.values()].sort((a, b) =>
		a.id.localeCompare(b.id),
	);

	console.log(`\n${SEP}`);
	const newlyUploaded = finalEntries.length - totalPreviouslyUploaded;
	console.log(`   ✓ all ${newlyUploaded} icons uploaded successfully`);
	console.log(
		`   💾 saved    ${finalEntries.length} icons → ${OUTPUT_JSON}`,
	);
	console.log(`${SEP}\n`);
}

void main().catch((err) => {
	if (err instanceof AccountLockedError) {
		console.error(`\n${err.message}`);
	} else {
		console.error("\nUnexpected error:", err);
	}
	process.exit(1);
});
