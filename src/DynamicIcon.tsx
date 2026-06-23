import React from '@rbxts/react';
import { GetIconUri } from './IconTemplate';

/**
 * Props for the dynamic DynamicIcon component.
 * Extends standard ImageLabel props with an `icon` name string.
 */
export interface DynamicIconProps extends Partial<WritableInstanceProperties<ImageLabel>> {
	/** The icon identifier (kebab-case id, e.g. "activity", "airplay") */
	name: string;
	/** React children for icon combining (nesting icons) */
	children?: React.ReactNode;
}

/**
 * Dynamic icon component.
 * Resolves an icon by its string name at runtime.
 *
 * @example
 * ```tsx
 * <DynamicIcon name="activity" Size={UDim2.fromOffset(48, 48)} />
 * ```
 *
 * Supports Lucide-style icon combining by nesting children:
 * ```tsx
 * <DynamicIcon name="circle">
 *   <DynamicIcon name="check" />
 * </DynamicIcon>
 * ```
 */
export function DynamicIcon(props: DynamicIconProps): React.Element {
	const uri = GetIconUri(props.name);
	if (uri === '') {
		warn(`[Lucide] DynamicIcon: icon "${props.name}" not found`);
	}

	return (
		<imagelabel
			Image={uri !== '' ? uri : undefined}
			BackgroundTransparency={1}
			Size={new UDim2(0, 24, 0, 24)}
			ScaleType={'Fit'}
			{...props}
		>
			{props.children}
		</imagelabel>
	);
}
