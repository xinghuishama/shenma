function buildFilterSets(filters) {
  const sets = {};
  for (const k in filters) {
    sets[k] = new Set(filters[k]);
  }
  return sets;
}