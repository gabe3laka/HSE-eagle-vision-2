## Fix Lightning CSS `@import` order error

**Cause:** In `src/styles.css`, line 2 is `@source "../src";` sitting between `@import "tailwindcss"` (line 1) and `@import "tw-animate-css"` (line 3) plus the Google Fonts `@import url(...)` on line 5. Lightning CSS requires every `@import` to appear before any non-`@import`/`@charset`/`@layer` rule, and `@source` is neither — so it rejects the later imports.

**Fix:** Move all three `@import` statements to the very top, then put `@source` after them.

```css
@import "tailwindcss" source(none);
@import "tw-animate-css";
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap');

@source "../src";

@custom-variant dark (&:is(.dark *));
...
```

No other changes — rest of the file (theme, layers, keyframes) stays as-is.
