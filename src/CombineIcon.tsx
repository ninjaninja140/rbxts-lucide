import React from '@rbxts/react';
import { GetIconUri } from './IconTemplate';

/**
 * Creates a combined icon by layering multiple icons.
 * Useful for compositing icons together (Lucide-style icon combining).
 *
 * @example
 * ```tsx
 * <CombineIcons icons={["circle", "check"]} />
 * ```
 */
export function CombineIcons(
	props: {
		icons: string[];
	} & Partial<WritableInstanceProperties<ImageLabel>>
): React.Element {
	// Exclude custom props (icons) from being passed to ImageLabel
	const imageLabelProps = { ...props } as Record<string, unknown>;
	imageLabelProps.icons = undefined;

	// Build elements from innermost to outermost
	let element: React.Element | undefined;

	for (let i = props.icons.size() - 1; i >= 0; i--) {
		const iconName = props.icons[i];
		const iconUri = GetIconUri(iconName);

		element = (
			<imagelabel
				Image={iconUri !== '' ? iconUri : undefined}
				BackgroundTransparency={1}
				Size={new UDim2(1, 0, 1, 0)}
				ScaleType={'Fit'}
				{...(i === 0 ? imageLabelProps : {})}
			>
				{element}
			</imagelabel>
		);
	}

	return element ?? <imagelabel {...imageLabelProps} />;
}
