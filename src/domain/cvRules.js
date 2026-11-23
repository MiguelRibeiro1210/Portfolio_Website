export const cvSizeLimit = 10 * 1024 * 1024;

const limits = {
  name: 100, role: 150, location: 150, email: 254,
  summary: 5000, experience: 10000, education: 5000, skills: 5000,
  github: 2048, linkedin: 2048,
};

export function cvError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function profileFields(input) {

  const fields = {};
  for (const [name, limit] of Object.entries(limits)) {
    const value = input[name] ?? '';
    if (typeof value !== 'string' || value.includes('\0') || value.trim().length > limit) {
      throw cvError(`Invalid ${name}. The limit is ${limit} characters.`);
    }
    fields[name] = value.trim();
  }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    throw cvError('Enter a valid contact email.');
  }
  for (const name of ['github', 'linkedin']) {
    if (!fields[name]) continue;
    const url = URL.canParse(fields[name]) ? new URL(fields[name]) : null;
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw cvError('Social links must use HTTP or HTTPS.');
    }
  }
  return fields;
}

export function validatePdf(file) {
  const { buffer, originalname, size } = file;
  const header = buffer.subarray(0, 16).toString('latin1');
  const trailer = buffer.subarray(-2048).toString('latin1');
  const crossReference = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(trailer);
  const offset = Number(crossReference?.[1]);
  const xref = buffer.subarray(offset, offset + 64).toString('latin1');
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(header) ||
      !Number.isSafeInteger(offset) || offset < 9 || offset >= size ||
      !/^(xref[\r\n]|\d+\s+\d+\s+obj\b)/.test(xref)) {
    throw cvError('Choose a valid PDF file.');
  }
  const name = originalname.replace(/[\x00-\x1f\x7f/\\]/g, '').trim();
  return { name: [...name].slice(0, 150).join('') || 'CV.pdf', size };
}
