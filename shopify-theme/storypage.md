# Our Story Page Template - Status Document

## Goal
Create a new Shopify page template (`page.our-story.liquid`) for the "Our Story" page, mimicking the Titleist Story page layout (https://www.titleist.eu/company/titleist-story). The template should include:
- A full-width banner at the top with the tagline
- Alternating image/text sections that slide in on scroll
- Tim.jpg included in the first content block
- All content sourced from `_our_story_page/Our Story Page.docx`
- Placeholder images from https://placehold.co/ for any missing images
- Commit and push to a new branch `feature/our-story-template`

## What's Been Done

### 1. Explored the codebase
- Listed files in `_our_story_page/` directory: contains `Our Story Page.docx` and `Tim.jpg`
- Listed existing page templates in `templates/` to understand naming conventions (e.g., `page.about.json`, `page.contact.json`)
- Listed assets to understand available CSS/JS files

### 2. Read existing templates for reference
- Read `templates/page.json` (default page template) - uses sections: breadcrumbs, main-page, rich-text, multicolumn, scrolling-promotion
- Read `templates/page.about.json` - similar structure with rich-text and multicolumn sections
- Both are JSON templates that reference section types (not liquid templates directly)

### 3. Extracted content from Word document
Content structure from `Our Story Page.docx`:

- **Banner tagline**: "Ball Pro exists to serve the promotional industry distributor by owning the process from start to finish, delivering the quality control our customers need at the speed their business demands."
- **First Block**: Image of Tim + text about Tim Hanson acquiring Pro Ball, renaming to Ball Pro
- **Second Block**: Text about investing in inventory/printing tech, turnaround from 1 month to 5 days
- **Separation Block**: "More than thirty years later, that belief still drives us. Three-day turns are now standard, and we continue to push the industry forward with a free 24-hour rush program."
- **Third Block**: Text about 2017 Diversified Ad-Tee acquisition (kitchen/drinkware)
- **Fourth Block**: Text about 2025 Branded Apparel acquisition
- **Final black block**: "Your trusted Pros in promo."

### 4. Attempted to fetch Titleist reference page
- Got 403 error from both .eu and .com domains - could not scrape the reference page

## What Needs To Be Done

### 1. Understand the Titleist page layout
- Manually visit https://www.titleist.eu/company/titleist-story to understand the layout pattern
- Based on typical Titleist Story pages: full-width hero banner, then alternating left-image/right-text and right-image/left-text sections with scroll-triggered animations, ending with a dark CTA section

### 2. Create the Liquid template
- Create `templates/page.our-story.liquid` (a `.liquid` template, not JSON, since we need custom layout)
- OR create `sections/main-page-our-story.liquid` + `templates/page.our-story.json`
- Structure:
  - Full-width hero banner with background image + overlay tagline text
  - Section 1: Tim.jpg (left) + founding story text (right)
  - Section 2: Placeholder image (right) + speed/quality text (left)
  - Separation: Full-width text banner with the "30 years later" quote
  - Section 3: Placeholder image (left) + Diversified Ad-Tee text (right)
  - Section 4: Placeholder image (right) + Branded Apparel text (left)
  - Final: Full-width black section with "Your trusted Pros in promo."
- Add CSS for scroll-triggered slide-in animations (IntersectionObserver-based)

### 3. Upload Tim.jpg to theme assets
- Copy `Tim.jpg` to `assets/tim-hanson.jpg` (or appropriate name)

### 4. Add CSS animations
- Add slide-in animation styles (can go inline in the template or in a new asset file)

### 5. Git workflow
- Create branch `feature/our-story-template`
- Commit all new/modified files
- Push to remote

## Key Technical Notes
- Theme uses Shopify Online Store 2.0 (JSON templates + sections)
- Existing page templates are JSON files referencing section types
- For a fully custom layout, a `.liquid` page template is more appropriate than JSON
- The theme has existing CSS in `assets/customer.css`, `assets/collection.css`, etc.
- Need to check `layout/theme.liquid` for how page templates are rendered
