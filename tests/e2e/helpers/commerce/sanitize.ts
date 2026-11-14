export function sanitizeLog(text: string): string {
	return text
		.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '<jwt>')
		.replace(/\b(?:\d{4}[ -]?){3}\d{4}\b/g, '<card>')
		.replace(/("(?:key|token|secret|apiKey|webhookSecret)"\s*:\s*)"[^"]*"/gi, '$1"<redacted>"')
		.replace(/([?&]t=)[^&]+/g, '$1<redacted>')
		.replace(/([?&]signature=)[^&]+/g, '$1<redacted>');
}

export function redactUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.searchParams.has('t')) parsed.searchParams.set('t', '<redacted>');
		if (parsed.searchParams.has('signature')) parsed.searchParams.set('signature', '<redacted>');
		return parsed.toString();
	} catch {
		return sanitizeLog(url);
	}
}

export function normalizeAccessKey(value: string): string {
	return value.replace(/[-\s]/g, '').trim();
}

export function redactPageText(text: string): string {
	return sanitizeLog(text).replace(/\s+/g, ' ').trim().slice(0, 800);
}
