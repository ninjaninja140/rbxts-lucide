import React from '@rbxts/react';
import iconsData from './icon-data.json';

export interface IconProps extends Partial<WritableInstanceProperties<ImageLabel>> {
	/** The icon identifier (kebab-case id from the icon set) */
	icon: string;
	/** React children - for Lucide-style icon combining (nesting icons) */
	children?: React.ReactNode;
}

export interface IconData {
	id: string;
	title: string;
	assetId: number;
	uri: string;
	contributors: string;
}

const iconMap = new Map<string, IconData>();

// Build lookup map on module load
for (const item of iconsData as IconData[]) {
	iconMap.set(item.id, item);
}

/**
 * Base icon template that renders a Roblox ImageLabel with the appropriate
 * icon asset from the Lucide icon set.
 *
 * Supports Lucide's icon combining pattern - pass children to nest icons
 * within each other.
 */
export function IconTemplate(props: IconProps): React.Element {
	const iconData = iconMap.get(props.icon);

	if (!iconData) {
		warn(`[Lucide] Icon "${props.icon}" not found in icon set`);
		return <imagelabel {...props}>{props.children}</imagelabel>;
	}

	return (
		<imagelabel
			Image={iconData.uri}
			BackgroundTransparency={1}
			Size={new UDim2(0, 24, 0, 24)}
			ScaleType={Enum.ScaleType.Fit}
			{...props}
		>
			{props.children}
		</imagelabel>
	);
}

/**
 * Retrieves the icon data for a given icon id.
 * Returns undefined if the icon is not found.
 */
export function GetIconData(iconName: string): IconData | undefined {
	return iconMap.get(iconName);
}

/**
 * Retrieves the Roblox asset URI for a given icon id.
 * Returns an empty string if the icon is not found.
 */
export function GetIconUri(iconName: string): string {
	const data = iconMap.get(iconName);
	return data ? data.uri : '';
}

/**
 * Returns all available icon data entries.
 */
export function GetAllIcons(): IconData[] {
	const result: IconData[] = [];
	iconMap.forEach((value) => result.push(value));
	return result;
}

export default IconTemplate;
