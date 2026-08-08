import fs from 'node:fs';
import path from 'node:path';

const ICONS_JSON = path.resolve('src/icon-data.json');
const OUTPUT_DIR = path.resolve('src/icons');

interface IconEntry {
	id: string;
	title: string;
	assetId: number;
	uri: string;
	contributors: string;
}

function main() {
	if (!fs.existsSync(ICONS_JSON)) {
		console.error(`${ICONS_JSON} not found. Run upload-pngs first.`);
		process.exit(1);
	}

	const raw = fs.readFileSync(ICONS_JSON, 'utf-8');
	const icons = JSON.parse(raw) as IconEntry[];

	console.log(`📋 Found ${icons.length} icons to generate.\n`);


	fs.mkdirSync(OUTPUT_DIR, { recursive: true });

	let generated = 0;

	for (const icon of icons) {
		const componentName = icon.title;
		const iconId = icon.id;

		const tsxContent = `import React from "@rbxts/react";
import { IconTemplate, type IconProps } from "../IconTemplate";

export default function ${componentName}(props: Partial<IconProps>): React.Element {
	return (
		<IconTemplate
			icon="${iconId}"
			{...props}
		/>
	);
}
`;

		const filePath = path.join(OUTPUT_DIR, `${iconId}.tsx`);
		fs.writeFileSync(filePath, tsxContent, 'utf-8');
		generated++;
	}

	const barrelExports = icons.map((icon) => `export { default as ${icon.title} } from "./${icon.id}";`).join('\n');

	const barrelContent = `

${barrelExports}
`;

	fs.writeFileSync(path.join(OUTPUT_DIR, 'index.ts'), barrelContent, 'utf-8');

	console.log(`Generated ${generated} icon components in ${OUTPUT_DIR}`);
	console.log(`Generated barrel index at ${path.join(OUTPUT_DIR, 'index.ts')}`);
}

void main();
