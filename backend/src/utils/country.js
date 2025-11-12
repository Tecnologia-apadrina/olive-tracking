const DEFAULT_COUNTRY = 'ES';
const SUPPORTED_COUNTRIES = ['ES', 'PT'];

function normalizeCountryCode(value, fallback = DEFAULT_COUNTRY) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toUpperCase();
  if (SUPPORTED_COUNTRIES.includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function isValidCountryCode(value) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toUpperCase();
  return SUPPORTED_COUNTRIES.includes(normalized);
}

function resolveRequestCountry(req, fallback = DEFAULT_COUNTRY) {
  if (req && req.userCountry) {
    return normalizeCountryCode(req.userCountry, fallback);
  }
  return fallback;
}

module.exports = {
  DEFAULT_COUNTRY,
  SUPPORTED_COUNTRIES,
  normalizeCountryCode,
  isValidCountryCode,
  resolveRequestCountry,
};
