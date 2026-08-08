import fs from "node:fs";
import path from "node:path";

interface Bounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

interface SvgElement {

	tag: string;

	attrs: Record<string, string>;

	raw: string;

	bounds: Bounds;

	isClosed: boolean;

	isDetail: boolean;
}

function readSvg(filePath: string): string {
	return fs.readFileSync(filePath, "utf-8").trim();
}

function writeSvg(filePath: string, svg: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, svg, "utf-8");
}

function boundsArea(b: Bounds): number {
	return (b.right - b.left) * (b.bottom - b.top);
}

function overlapRatio(inner: Bounds, outer: Bounds): number {
	const ix = Math.max(inner.left, outer.left);
	const iy = Math.max(inner.top, outer.top);
	const iw = Math.min(inner.right, outer.right) - ix;
	const ih = Math.min(inner.bottom, outer.bottom) - iy;
	if (iw <= 0 || ih <= 0) return 0;

	const innerArea = boundsArea(inner);
	if (innerArea <= 0) return 0;
	return Math.min(1, (iw * ih) / innerArea);
}

function inflateBounds(b: Bounds, amount: number): Bounds {
	return {
		left: b.left - amount,
		top: b.top - amount,
		right: b.right + amount,
		bottom: b.bottom + amount,
	};
}

function parseElements(svg: string): { raw: string; tag: string; attrs: Record<string, string> }[] {
	const shapeTags = ["circle", "rect", "path", "line", "ellipse", "polyline", "polygon"];


	const inner = svg.replace(/<svg[^>]*>|<\/svg>/gi, "").trim();

	const result: { raw: string; tag: string; attrs: Record<string, string> }[] = [];


	const elemRegex = /<(\w+)((?:\s+[^>]*?)?)\s*(\/?)>/g;
	const stack: { tag: string; raw: string; attrs: Record<string, string>; isSelfClosing: boolean }[] = [];

	let match;
	while ((match = elemRegex.exec(inner)) !== null) {
		const tag = match[1].toLowerCase();
		const attrStr = match[2].trim();
		const selfClosing = match[3] === "/";

		if (!shapeTags.includes(tag)) continue;

		const attrs = parseAttributes(attrStr);

		if (selfClosing) {
			result.push({ raw: match[0], tag, attrs });
		} else {

			const closeStart = elemRegex.lastIndex;
			const closeTag = `</${tag}>`;
			const closeIdx = inner.indexOf(closeTag, closeStart);

			if (closeIdx === -1) {

				result.push({ raw: match[0], tag, attrs });
			} else {
				const fullRaw = inner.slice(match.index, closeIdx + closeTag.length);
				result.push({ raw: fullRaw, tag, attrs });
				elemRegex.lastIndex = closeIdx + closeTag.length;
			}
		}
	}

	return result;
}

function parseAttributes(attrStr: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const attrRegex = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
	let m;
	while ((m = attrRegex.exec(attrStr)) !== null) {
		attrs[m[1]] = m[2];
	}
	return attrs;
}

function computeBounds(el: { tag: string; attrs: Record<string, string> }): Bounds {
	switch (el.tag) {
		case "circle": {
			const cx = parseFloat(el.attrs.cx) || 0;
			const cy = parseFloat(el.attrs.cy) || 0;
			const r = parseFloat(el.attrs.r) || 0;
			return { left: cx - r, top: cy - r, right: cx + r, bottom: cy + r };
		}
		case "ellipse": {
			const cx = parseFloat(el.attrs.cx) || 0;
			const cy = parseFloat(el.attrs.cy) || 0;
			const rx = parseFloat(el.attrs.rx) || 0;
			const ry = parseFloat(el.attrs.ry) || 0;
			return { left: cx - rx, top: cy - ry, right: cx + rx, bottom: cy + ry };
		}
		case "rect": {
			const x = parseFloat(el.attrs.x) || 0;
			const y = parseFloat(el.attrs.y) || 0;
			const w = parseFloat(el.attrs.width) || 0;
			const h = parseFloat(el.attrs.height) || 0;
			return { left: x, top: y, right: x + w, bottom: y + h };
		}
		case "line": {
			const x1 = parseFloat(el.attrs.x1) || 0;
			const y1 = parseFloat(el.attrs.y1) || 0;
			const x2 = parseFloat(el.attrs.x2) || 0;
			const y2 = parseFloat(el.attrs.y2) || 0;
			return {
				left: Math.min(x1, x2),
				top: Math.min(y1, y2),
				right: Math.max(x1, x2),
				bottom: Math.max(y1, y2),
			};
		}
		case "polyline":
		case "polygon": {
			const pts = (el.attrs.points || "").trim().split(/[\s,]+/).map(Number);
			const bounds = ptsToBounds(pts);
			return bounds;
		}
		case "path": {
			const d = el.attrs.d || "";
			return computePathBounds(d);
		}
		default:
			return { left: 0, top: 0, right: 0, bottom: 0 };
	}
}

function ptsToBounds(nums: number[]): Bounds {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (let i = 0; i + 1 < nums.length; i += 2) {
		const x = nums[i];
		const y = nums[i + 1];
		if (!isNaN(x) && !isNaN(y)) {
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		}
	}
	if (!isFinite(minX)) return { left: 0, top: 0, right: 0, bottom: 0 };
	return { left: minX, top: minY, right: maxX, bottom: maxY };
}

function computePathBounds(d: string): Bounds {
	const tokens = tokenizePath(d);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	let curX = 0, curY = 0;
	let i = 0;

	function record(x: number, y: number) {
		if (isFinite(x) && isFinite(y)) {
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
			maxY = Math.max(maxY, y);
		}
	}

	function absX(v: number, rel: boolean) { return rel ? curX + v : v; }
	function absY(v: number, rel: boolean) { return rel ? curY + v : v; }

	while (i < tokens.length) {
		const cmd = tokens[i];
		if (typeof cmd !== "string") { i++; continue; }

		const upperCmd = cmd.toUpperCase();
		const isRel = cmd === cmd.toLowerCase();
		i++;


		const args: number[] = [];
		while (i < tokens.length && typeof tokens[i] === "number") {
			args.push(tokens[i] as number);
			i++;
		}

		let j = 0;
		while (j < args.length) {
			switch (upperCmd) {
				case "M":
				case "L":
				case "T": {
					if (j + 1 >= args.length) { j = args.length; break; }
					const x = absX(args[j], isRel);
					const y = absY(args[j + 1], isRel);
					record(x, y);
					curX = x; curY = y;
					j += 2;

					if (upperCmd === "M") break;
					break;
				}
				case "H": {
					const x = absX(args[j], isRel);
					record(x, curY);
					curX = x;
					j++;
					break;
				}
				case "V": {
					const y = absY(args[j], isRel);
					record(curX, y);
					curY = y;
					j++;
					break;
				}
				case "C": {
					if (j + 5 >= args.length) { j = args.length; break; }

					record(absX(args[j], isRel), absY(args[j + 1], isRel));
					record(absX(args[j + 2], isRel), absY(args[j + 3], isRel));
					const cx = absX(args[j + 4], isRel);
					const cy = absY(args[j + 5], isRel);
					record(cx, cy);
					curX = cx; curY = cy;
					j += 6;
					break;
				}
				case "S":
				case "Q": {
					if (j + 3 >= args.length) { j = args.length; break; }

					record(absX(args[j], isRel), absY(args[j + 1], isRel));
					const qx = absX(args[j + 2], isRel);
					const qy = absY(args[j + 3], isRel);
					record(qx, qy);
					curX = qx; curY = qy;
					j += 4;
					break;
				}
				case "A": {
					if (j + 6 >= args.length) { j = args.length; break; }

					const ax = absX(args[j + 5], isRel);
					const ay = absY(args[j + 6], isRel);
					record(ax, ay);
					curX = ax; curY = ay;
					j += 7;
					break;
				}
				case "Z": {
					break;
				}
				default: {
					j = args.length;
					break;
				}
			}


			if (upperCmd === "M" && j < args.length) {



				while (j + 1 < args.length) {
					const x = absX(args[j], isRel);
					const y = absY(args[j + 1], isRel);
					record(x, y);
					j += 2;
				}
			}
		}
	}

	if (!isFinite(minX)) return { left: 0, top: 0, right: 24, bottom: 24 };
	return { left: minX, top: minY, right: maxX, bottom: maxY };
}

function tokenizePath(d: string): (string | number)[] {
	const tokens: (string | number)[] = [];
	const re = /([a-zA-Z])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
	let m;
	while ((m = re.exec(d)) !== null) {
		if (m[1] !== undefined) {
			tokens.push(m[1]);
		} else if (m[2] !== undefined) {
			tokens.push(parseFloat(m[2]));
		}
	}
	return tokens;
}

function isClosedElement(el: { tag: string; attrs: Record<string, string> }): boolean {
	switch (el.tag) {
		case "circle":
		case "rect":
		case "ellipse":
		case "polygon":
			return true;
		case "path": {
			const d = (el.attrs.d || "").trim();

			if (/z$/i.test(d)) return true;

			return pathStartAndEndMatch(d);
		}
		default:
			return false;
	}
}

function pathStartAndEndMatch(d: string): boolean {
	const tokens = tokenizePath(d);
	let firstX = NaN, firstY = NaN;
	let lastX = 0, lastY = 0, curX = 0, curY = 0;

	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (typeof t !== "string") continue;
		const upper = t.toUpperCase();
		const isRel = t === t.toLowerCase();
		const args: number[] = [];
		let j = i + 1;
		while (j < tokens.length && typeof tokens[j] === "number") {
			args.push(tokens[j] as number);
			j++;
		}

		if (upper === "M" || upper === "L" || upper === "T") {
			for (let k = 0; k + 1 < args.length; k += 2) {
				const x = isRel ? curX + args[k] : args[k];
				const y = isRel ? curY + args[k + 1] : args[k + 1];
				if (isNaN(firstX)) { firstX = x; firstY = y; }
				lastX = x; lastY = y;
				curX = x; curY = y;
			}
		} else if (upper === "H") {
			for (const v of args) {
				const x = isRel ? curX + v : v;
				if (isNaN(firstX)) { firstX = x; firstY = curY; }
				lastX = x; lastY = curY;
				curX = x;
			}
		} else if (upper === "V") {
			for (const v of args) {
				const y = isRel ? curY + v : v;
				if (isNaN(firstX)) { firstX = curX; firstY = y; }
				lastX = curX; lastY = y;
				curY = y;
			}
		} else if (upper === "C") {
			for (let k = 0; k + 5 < args.length; k += 6) {
				const x = isRel ? curX + args[k + 4] : args[k + 4];
				const y = isRel ? curY + args[k + 5] : args[k + 5];
				if (isNaN(firstX)) { firstX = x; firstY = y; }
				lastX = x; lastY = y;
				curX = x; curY = y;
			}
		} else if (upper === "S" || upper === "Q") {
			for (let k = 0; k + 3 < args.length; k += 4) {
				const x = isRel ? curX + args[k + 2] : args[k + 2];
				const y = isRel ? curY + args[k + 3] : args[k + 3];
				if (isNaN(firstX)) { firstX = x; firstY = y; }
				lastX = x; lastY = y;
				curX = x; curY = y;
			}
		} else if (upper === "A") {
			for (let k = 0; k + 6 < args.length; k += 7) {
				const x = isRel ? curX + args[k + 5] : args[k + 5];
				const y = isRel ? curY + args[k + 6] : args[k + 6];
				if (isNaN(firstX)) { firstX = x; firstY = y; }
				lastX = x; lastY = y;
				curX = x; curY = y;
			}
		}
		i = j - 1;
	}

	if (isNaN(firstX)) return false;
	const dx = lastX - firstX;
	const dy = lastY - firstY;
	return Math.sqrt(dx * dx + dy * dy) <= 0.5;
}

function getPathEndpointInfo(d: string): { sx: number; sy: number; ex: number; ey: number; segments: number } | null {
	const tokens = tokenizePath(d);
	let sx = NaN, sy = NaN, ex = 0, ey = 0, curX = 0, curY = 0;
	let segmentCount = 0;
	let firstMove = true;

	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (typeof t !== "string") continue;
		const upper = t.toUpperCase();
		const isRel = t === t.toLowerCase();
		const args: number[] = [];
		let j = i + 1;
		while (j < tokens.length && typeof tokens[j] === "number") {
			args.push(tokens[j] as number);
			j++;
		}

		switch (upper) {
			case "M": {
				for (let k = 0; k + 1 < args.length; k += 2) {
					const x = isRel ? curX + args[k] : args[k];
					const y = isRel ? curY + args[k + 1] : args[k + 1];
					if (isNaN(sx)) { sx = x; sy = y; }
					ex = x; ey = y;
					curX = x; curY = y;
					if (!firstMove) segmentCount++;
					firstMove = false;
				}


				break;
			}
			case "L":
			case "T": {
				for (let k = 0; k + 1 < args.length; k += 2) {
					const x = isRel ? curX + args[k] : args[k];
					const y = isRel ? curY + args[k + 1] : args[k + 1];
					ex = x; ey = y;
					curX = x; curY = y;
					segmentCount++;
				}
				break;
			}
			case "H": {
				for (const v of args) {
					curX = isRel ? curX + v : v;
					ex = curX; ey = curY;
					segmentCount++;
				}
				break;
			}
			case "V": {
				for (const v of args) {
					curY = isRel ? curY + v : v;
					ex = curX; ey = curY;
					segmentCount++;
				}
				break;
			}
			case "C": {
				for (let k = 0; k + 5 < args.length; k += 6) {
					curX = isRel ? curX + args[k + 4] : args[k + 4];
					curY = isRel ? curY + args[k + 5] : args[k + 5];
					ex = curX; ey = curY;
					segmentCount++;
				}
				break;
			}
			case "S":
			case "Q": {
				for (let k = 0; k + 3 < args.length; k += 4) {
					curX = isRel ? curX + args[k + 2] : args[k + 2];
					curY = isRel ? curY + args[k + 3] : args[k + 3];
					ex = curX; ey = curY;
					segmentCount++;
				}
				break;
			}
			case "A": {
				for (let k = 0; k + 6 < args.length; k += 7) {
					curX = isRel ? curX + args[k + 5] : args[k + 5];
					curY = isRel ? curY + args[k + 6] : args[k + 6];
					ex = curX; ey = curY;
					segmentCount++;
				}
				break;
			}
		}
		i = j - 1;
	}

	if (isNaN(sx)) return null;
	return { sx, sy, ex, ey, segments: segmentCount };
}

function splitPathIntoSegments(d: string): string[] {
	const tokens = tokenizePath(d);
	const result: string[] = [];
	let curX = 0, curY = 0;
	let firstPointX = 0, firstPointY = 0;
	let haveFirstPoint = false;

	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (typeof t !== "string") continue;
		const upper = t.toUpperCase();
		const isRel = t === t.toLowerCase();
		const args: number[] = [];
		let j = i + 1;
		while (j < tokens.length && typeof tokens[j] === "number") {
			args.push(tokens[j] as number);
			j++;
		}

		switch (upper) {
			case "M": {
				for (let k = 0; k + 1 < args.length; k += 2) {
					const prevX = curX, prevY = curY;
					const x = isRel ? curX + args[k] : args[k];
					const y = isRel ? curY + args[k + 1] : args[k + 1];
					if (!haveFirstPoint) {
						firstPointX = x; firstPointY = y;
						haveFirstPoint = true;
					}
					curX = x; curY = y;

					if (k >= 2) {
						result.push(`M${prevX} ${prevY}L${x} ${y}`);
					}
				}
				break;
			}
			case "L":
			case "T": {
				for (let k = 0; k + 1 < args.length; k += 2) {
					const px = curX, py = curY;
					curX = isRel ? curX + args[k] : args[k];
					curY = isRel ? curY + args[k + 1] : args[k + 1];
					result.push(`M${px} ${py}L${curX} ${curY}`);
				}
				break;
			}
			case "H": {
				for (const v of args) {
					const px = curX;
					curX = isRel ? curX + v : v;
					result.push(`M${px} ${curY}H${curX}`);
				}
				break;
			}
			case "V": {
				for (const v of args) {
					const py = curY;
					curY = isRel ? curY + v : v;
					result.push(`M${curX} ${py}V${curY}`);
				}
				break;
			}
			case "C": {
				for (let k = 0; k + 5 < args.length; k += 6) {
					const px = curX, py = curY;
					const cp1x = isRel ? curX + args[k] : args[k];
					const cp1y = isRel ? curY + args[k + 1] : args[k + 1];
					const cp2x = isRel ? curX + args[k + 2] : args[k + 2];
					const cp2y = isRel ? curY + args[k + 3] : args[k + 3];
					curX = isRel ? curX + args[k + 4] : args[k + 4];
					curY = isRel ? curY + args[k + 5] : args[k + 5];
					result.push(`M${px} ${py}C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${curX} ${curY}`);
				}
				break;
			}
			case "S":
			case "Q": {
				for (let k = 0; k + 3 < args.length; k += 4) {
					const px = curX, py = curY;
					const cp1x = isRel ? curX + args[k] : args[k];
					const cp1y = isRel ? curY + args[k + 1] : args[k + 1];
					curX = isRel ? curX + args[k + 2] : args[k + 2];
					curY = isRel ? curY + args[k + 3] : args[k + 3];
					result.push(`M${px} ${py}Q${cp1x} ${cp1y} ${curX} ${curY}`);
				}
				break;
			}
			case "A": {
				for (let k = 0; k + 6 < args.length; k += 7) {
					const px = curX, py = curY;
					const rx = args[k], ry = args[k + 1];
					const xrot = args[k + 2], large = args[k + 3], sweep = args[k + 4];
					curX = isRel ? curX + args[k + 5] : args[k + 5];
					curY = isRel ? curY + args[k + 6] : args[k + 6];
					result.push(`M${px} ${py}A${rx} ${ry} ${xrot} ${large} ${sweep} ${curX} ${curY}`);
				}
				break;
			}
		}
		i = j - 1;
	}

	return result;
}

function classify(elements: SvgElement[], effectiveBounds: (el: SvgElement) => Bounds): void {

	const sorted = [...elements].sort(
		(a, b) => boundsArea(effectiveBounds(b)) - boundsArea(effectiveBounds(a)),
	);

	for (const el of elements) el.isDetail = false;

	for (let i = 0; i < sorted.length; i++) {
		const outer = sorted[i];
		if (outer.isDetail) continue;


		const outerRaw = outer.bounds;

		for (let j = i + 1; j < sorted.length; j++) {
			const inner = sorted[j];
			if (inner.isDetail) continue;


			const innerEff = effectiveBounds(inner);

			const overlap = overlapRatio(innerEff, outerRaw);
			const sizeRatio =
				boundsArea(innerEff) / Math.max(boundsArea(outerRaw), 0.01);

			if (overlap >= 0.95 && sizeRatio <= 0.4) {
				inner.isDetail = true;
			}
		}
	}
}

function extractSvgMeta(svg: string) {
	const svgTagMatch = svg.match(/<svg([^>]*)>/i);
	const attrStr = svgTagMatch ? svgTagMatch[1] : "";

	const getAttr = (name: string) => {
		const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i");
		const m = attrStr.match(re);
		return m ? m[1] : null;
	};

	return {
		viewBox: getAttr("viewBox") || "0 0 24 24",
		width: getAttr("width") || "24",
		height: getAttr("height") || "24",
		xmlns: getAttr("xmlns") || "http://www.w3.org/2000/svg",
		strokeWidth: getAttr("stroke-width") || "2",
	};
}

export function smartInvert(svgString: string): string {
	const meta = extractSvgMeta(svgString);
	const strokeWidth = meta.strokeWidth;


	const parsed = parseElements(svgString);
	if (parsed.length === 0) return svgString;


	const elements: SvgElement[] = parsed.map((p) => ({
		...p,
		bounds: computeBounds(p),
		isClosed: isClosedElement(p),
		isDetail: false,
	}));




	const halfStroke = Number(strokeWidth) / 2;
	const effBounds = (el: SvgElement): Bounds =>
		inflateBounds(el.bounds, halfStroke);

	classify(elements, effBounds);

	const bodies = elements.filter((e) => !e.isDetail);
	const details = elements.filter((e) => e.isDetail);

	if (bodies.length === 0) return svgString;


	const lines: string[] = [];
	lines.push(`<svg`);
	lines.push(`  xmlns="${meta.xmlns}"`);
	lines.push(`  width="${meta.width}"`);
	lines.push(`  height="${meta.height}"`);
	lines.push(`  viewBox="${meta.viewBox}"`);
	lines.push(`  fill="currentColor"`);

	if (details.length > 0) {

		const maskId = "a";

		lines.push(">");
		lines.push("  <defs>");
		lines.push(`    <mask id="${maskId}">`);

		const [vbX, vbY, vbW, vbH] = meta.viewBox.split(/\s+/).map(Number);
		lines.push(`      <path fill="#fff" d="M${vbX} ${vbY}h${vbW}v${vbH}H${vbX}z"/>`);


		for (const d of details) {
			for (const elem of buildDetailMaskElements(d, strokeWidth)) {
				lines.push(`      ${elem}`);
			}
		}

		lines.push("    </mask>");
		lines.push("  </defs>");


		for (const b of bodies) {
			lines.push(`  ${buildBodyElement(b, `url(#${maskId})`)}`);
		}
	} else {

		lines.push(">");
		for (const b of bodies) {
			lines.push(`  ${buildBodyElement(b, null)}`);
		}
	}

	lines.push("</svg>");
	lines.push("");

	return lines.join("\n");
}

function buildBodyElement(el: SvgElement, maskUrl: string | null): string {
	const attrs: string[] = [...Object.keys(el.attrs)];


	const stripAttrs = [
		"fill",
		"stroke",
		"stroke-width",
		"stroke-linecap",
		"stroke-linejoin",
		"stroke-miterlimit",
	];

	const filteredAttrs: string[] = [];
	for (const key of attrs) {
		if (!stripAttrs.includes(key.toLowerCase().replace(/_/g, "-"))) {
			filteredAttrs.push(key);
		}
	}

	if (el.isClosed) {
		filteredAttrs.push("fill");

	} else {

		filteredAttrs.push("stroke");
		filteredAttrs.push("stroke-width");
		filteredAttrs.push("stroke-linecap");
		filteredAttrs.push("stroke-linejoin");
	}

	if (maskUrl) {
		filteredAttrs.push("mask");
	}



	const attrParts: string[] = [];
	for (const key of filteredAttrs) {
		if (key === "fill") {
			if (el.isClosed) {

				continue;
			}
		}
		if (key === "stroke") {
			attrParts.push(`stroke="currentColor"`);
			continue;
		}
		if (key === "stroke-width") {
			attrParts.push(`stroke-width="${el.attrs["stroke-width"] || "2"}"`);
			continue;
		}
		if (key === "stroke-linecap") {
			attrParts.push(`stroke-linecap="round"`);
			continue;
		}
		if (key === "stroke-linejoin") {
			attrParts.push(`stroke-linejoin="round"`);
			continue;
		}
		if (key === "mask") {
			attrParts.push(`mask="${maskUrl}"`);
			continue;
		}
		const val = el.attrs[key];
		if (val !== undefined) {
			attrParts.push(`${key}="${val}"`);
		}
	}

	const attrStr = attrParts.length > 0 ? " " + attrParts.join(" ") : "";

	if (el.raw.endsWith("/>")) {
		return `<${el.tag}${attrStr} />`;
	}
	return `<${el.tag}${attrStr}>${getInnerContent(el.raw, el.tag)}</${el.tag}>`;
}

function getInnerContent(raw: string, tag: string): string {
	const openEnd = raw.indexOf(">") + 1;
	const closeTag = `</${tag}>`;
	const closeIdx = raw.lastIndexOf(closeTag);
	if (closeIdx === -1) return "";
	return raw.slice(openEnd, closeIdx).trim();
}

function buildDetailMaskElements(el: SvgElement, strokeWidth: string): string[] {
	if (el.isClosed) {
		const attrs = collectNonStyleAttrs(el);
		attrs.push(`fill="#000"`);
		const attrStr = attrs.join(" ");
		if (el.raw.endsWith("/>")) return [`<${el.tag} ${attrStr} />`];
		return [`<${el.tag} ${attrStr}>${getInnerContent(el.raw, el.tag)}</${el.tag}>`];
	}

	if (el.tag === "path") {
		const d = el.attrs.d || "";
		const info = getPathEndpointInfo(d);

		if (info && info.segments >= 2) {
			const segments = splitPathIntoSegments(d);
			return segments.map((segD) =>
				buildStrokedMaskPath(segD, el, strokeWidth, false),
			);
		}

		return [buildStrokedMaskPath(d, el, strokeWidth, false)];
	}

	return [buildStrokedMaskPath(null, el, strokeWidth, false)];
}

function collectNonStyleAttrs(el: SvgElement): string[] {
	const strip = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit"];
	const attrs: string[] = [];
	for (const key of Object.keys(el.attrs)) {
		if (!strip.includes(key.toLowerCase().replace(/_/g, "-"))) {
			const val = el.attrs[key];
			if (val !== undefined) attrs.push(`${key}="${val}"`);
		}
	}
	return attrs;
}

function buildStrokedMaskPath(
	d: string | null,
	el: SvgElement,
	strokeWidth: string,
	fillOnly: boolean,
): string {
	const parts: string[] = [];

	if (d !== null) parts.push(`d="${d}"`);

	if (fillOnly) {
		parts.push(`fill="#000"`);
	} else {
		parts.push(`fill="#000"`);
		parts.push(`stroke="#000"`);
		parts.push(`stroke-width="${strokeWidth}"`);
		parts.push(`stroke-linecap="round"`);
		parts.push(`stroke-linejoin="round"`);
	}

	return `<path ${parts.join(" ")} />`;
}

function parseArgs() {
	const args = process.argv.slice(2);
	if (args[0] === "--batch")
		return {
			mode: "batch" as const,
			input: args[1],
			output: args[2] || args[1],
		};

	return {
		mode: "single" as const,
		input: args[0],
		output: args[1] || args[0].replace(/\.svg$/i, "-filled.svg"),
	};
}

async function main() {
	const { mode, input, output } = parseArgs();

	if (!input) {
		console.error("Usage: npx tsx scripts/smart-invert.ts <input.svg> [output.svg]");
		console.error("       npx tsx scripts/smart-invert.ts --batch <input-dir> <output-dir>");
		process.exit(1);
	}

	if (mode === "batch") {
		if (!fs.statSync(input).isDirectory()) {
			console.error(`Input must be a directory in batch mode: ${input}`);
			process.exit(1);
		}

		fs.mkdirSync(output, { recursive: true });
		const files = fs
			.readdirSync(input)
			.filter((f) => f.toLowerCase().endsWith(".svg"));

		let ok = 0;
		let fail = 0;
		console.log(`Processing ${files.length} SVGs...`);

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			const svgString = readSvg(path.join(input, file));
			try {
				const result = smartInvert(svgString);
				writeSvg(path.join(output, file.replace(/\.svg$/i, "-filled.svg")), result);
				ok++;
			} catch (err) {
				console.error(`  FAILED: ${file} — ${(err as Error).message}`);
				fail++;
			}
			if ((i + 1) % 100 === 0 || i === files.length - 1) {
				console.log(`  ${i + 1}/${files.length} (${ok} ok, ${fail} failed)`);
			}
		}
		console.log(`Done! ${ok} ok, ${fail} failed`);
	} else {
		if (!fs.existsSync(input)) {
			console.error(`Input file not found: ${input}`);
			process.exit(1);
		}

		const svgString = readSvg(input);
		const result = smartInvert(svgString);
		writeSvg(output, result);

		console.log(`Output written to: ${output}`);
		console.log(`Input:  ${svgString.length} bytes`);
		console.log(`Output: ${result.length} bytes`);
	}
}

if (process.argv[1]?.includes("smart-invert")) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
