import { spawn } from "node:child_process";
import path from "node:path";

const SCRIPTS_DIR = path.resolve("scripts");
const STEPS: Array<{ name: string; script: string; args: string[] }> = [
	{
		name: "generate-pngs",
		script: "generate-pngs.ts",
		args: ["lucide/icons", "img"],
	},
	{
		name: "generate-fills",
		script: "generate-fills.ts",
		args: [],
	},
	{
		name: "generate-icons",
		script: "generate-icons.ts",
		args: [],
	},
	{
		name: "upload-pngs",
		script: "upload-pngs.ts",
		args: [],
	},
	{
		name: "convert-ids",
		script: "convert-ids.ts",
		args: [],
	},
];

function runStep(name: string, script: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const scriptPath = path.join(SCRIPTS_DIR, script);
		const child = spawn("npx", ["tsx", scriptPath, ...args], {
			stdio: "inherit",
			env: process.env,
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${name} exited with code ${code}`));
			}
		});

		child.on("error", (err) => {
			reject(new Error(`${name} failed to start: ${err.message}`));
		});
	});
}

(async () => {
	console.log("starting full icon pipeline\n");

	const total = STEPS.length;
	let completed = 0;

	for (const step of STEPS) {
		completed++;
		console.log(`\n▶  [${completed}/${total}] ${step.name}`);
		console.log("─".repeat(50));

		try {
			await runStep(step.name, step.script, step.args);
		} catch (err) {
			console.error(`\nPipeline failed at step ${completed} (${step.name}): ${(err as Error).message}`);
			process.exit(1);
		}
	}

	console.log(`\n${"─".repeat(50)}`);
	console.log(`Pipeline complete — all ${total} steps finished successfully!`);
})();
