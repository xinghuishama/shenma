function parseInput(input) {
  return [...new Set(
    input
      .split(/\s+/)
      .map(n => parseInt(n, 10))
      .filter(n => Number.isInteger(n) && n >= 1 && n <= 49)
  )];
}