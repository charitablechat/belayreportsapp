
# Remove Up/Down Arrow Icons from All Autocomplete Dropdowns

## Overview

Remove the `ChevronsUpDown` icon from all four autocomplete components. The "X" clear button already indicates the field is interactive, and the dropdown opens on focus -- the extra arrows add visual clutter.

## Changes

### 1. `src/components/GlobalAutocomplete.tsx`
- Remove `ChevronsUpDown` from the lucide-react import (line 2)
- Remove the `<ChevronsUpDown>` element (line 362)

### 2. `src/components/OrganizationAutocomplete.tsx`
- Remove `ChevronsUpDown` from the lucide-react import (line 8)
- Remove the `<ChevronsUpDown>` element (line 338)

### 3. `src/components/HistoryAutocomplete.tsx`
- Remove `ChevronsUpDown` from the lucide-react import (line 2)
- Remove the `<ChevronsUpDown>` element (line 353)

### 4. `src/components/DatabaseAutocomplete.tsx`
- Remove `ChevronsUpDown` from the lucide-react import (line 2)
- Remove the `<ChevronsUpDown>` element (line 336)

No other logic or layout changes needed -- the right-side icon container remains for the "X" clear button.
