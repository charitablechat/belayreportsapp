

## Generate Copyright Deposit Pages

**What**: Create a text file containing the first 25 pages (~1,250 lines) and last 25 pages (~1,250 lines) of your source code, formatted for copyright registration with the US Copyright Office.

### Approach

1. **Concatenate all source files** in a logical order (e.g., `src/` files alphabetically) into one continuous listing, with file headers marking each file boundary
2. **Extract first 1,250 lines** (≈25 pages at 50 lines/page)
3. **Extract last 1,250 lines** (≈25 pages at 50 lines/page)
4. **Add a separator** between the two sections indicating omitted material
5. **Output** to `/mnt/documents/copyright-deposit.txt`

### Format

Each page will include:
- File path header when a new file begins
- Line numbers for reference
- Standard 50 lines per page with page markers

### Notes

- The Copyright Office accepts identifying portions as either the first/last 25 pages OR first/last 10 pages with trade secret material blocked out
- This will be a plain text file you can print or submit digitally

