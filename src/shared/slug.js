export function slugify(value) {
  const output = String(value || "unknown-project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return output || "project";
}
