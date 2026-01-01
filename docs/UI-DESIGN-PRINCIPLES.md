# PRMX UI Design Principles

> **The Golden Rule**: Clean, compact, and purposeful. Every element should serve a clear function without visual noise.

This document establishes the design principles derived from the V3 Policy Detail page, which serves as the reference implementation for all UI components in the PRMX application.

---

## Core Principles

### 1. Minimal Visual Noise
- **No heavy borders** - Use subtle dividers (`border-border-primary/30`)
- **No gradient backgrounds** on containers - Use solid, subtle backgrounds
- **No decorative elements** - Every visual element must convey information

### 2. Compact & Information-Dense
- Prioritize **row-based layouts** over card grids
- Use **inline metadata** with dot separators
- Avoid redundant information display

### 3. Consistent Spacing
- Standard card padding: `p-5` (20px)
- Row padding: `py-2 px-3`
- Gap between elements: `gap-2` to `gap-3`
- Section dividers: `border-t border-border-primary/30` with `pt-3`

---

## Component Patterns

### Card Structure

```tsx
<Card className="overflow-hidden">
  <CardContent className="p-0">
    {/* Header Section */}
    <div className="px-5 py-4 border-b border-border-primary/50">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-prmx-cyan" />
        </div>
        <h3 className="text-base font-semibold">Section Title</h3>
      </div>
    </div>
    
    {/* Content Section */}
    <div className="p-5">
      {/* Content goes here */}
    </div>
  </CardContent>
</Card>
```

### Icon Containers

Use consistent icon boxes with accent backgrounds:

```tsx
// Standard icon box (32x32)
<div className="w-8 h-8 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
  <Icon className="w-4 h-4 text-prmx-cyan" />
</div>

// Large icon box (40x40) - for modal headers
<div className="w-10 h-10 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
  <Icon className="w-5 h-5 text-prmx-cyan" />
</div>

// Small icon box (28x28) - for list items
<div className="w-7 h-7 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
  <Icon className="w-3.5 h-3.5 text-prmx-cyan" />
</div>
```

**Icon color mapping:**
| Context | Background | Icon Color |
|---------|-----------|------------|
| Primary/Info | `bg-prmx-cyan/10` | `text-prmx-cyan` |
| Success/Money | `bg-emerald-500/10` | `text-emerald-500` |
| Warning | `bg-amber-500/10` | `text-amber-500` |
| Error/Sell | `bg-rose-500/10` | `text-rose-500` |
| Secondary | `bg-prmx-purple/10` | `text-prmx-purple` |
| Neutral | `bg-background-tertiary/50` | `text-text-tertiary` |

### Row-Based Data Display

Prefer rows over cards for data lists:

```tsx
{/* Data Row */}
<div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
  <span className="text-sm text-text-secondary">Label</span>
  <span className="text-sm font-semibold">Value</span>
</div>
```

### Inline Metadata

Use dots as separators for inline metadata:

```tsx
<div className="flex items-center gap-3 text-xs text-text-tertiary">
  <span className="flex items-center gap-1">
    <MapPin className="w-3 h-3" />
    Location Name
  </span>
  <span>•</span>
  <span>5 shares</span>
  <span>•</span>
  <span>3d left</span>
</div>
```

---

## Typography

### Text Sizes

| Use Case | Class |
|----------|-------|
| Page title | `text-3xl font-bold` |
| Section header | `text-base font-semibold` |
| Card title | `text-lg font-semibold` |
| Data label | `text-xs text-text-tertiary` |
| Data value | `text-sm font-medium` |
| Large value | `text-xl font-bold` or `text-2xl font-bold` |
| Tiny label | `text-[10px] text-text-tertiary uppercase tracking-wide` |

### Badge Styles

```tsx
{/* Version badges */}
<span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300">
  V3
</span>

{/* Status badges */}
<span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
  Active
</span>
```

**Badge variants:**
| Type | Light Mode | Dark Mode |
|------|------------|-----------|
| V3/Cyan | `bg-cyan-100 text-cyan-700` | `bg-cyan-500/20 text-cyan-300` |
| V2/Purple | `bg-purple-100 text-purple-700` | `bg-purple-500/20 text-purple-300` |
| V1/Slate | `bg-slate-100 text-slate-600` | `bg-slate-500/20 text-slate-300` |
| Success | `bg-emerald-100 text-emerald-700` | `bg-emerald-500/20 text-emerald-300` |
| Warning | `bg-amber-100 text-amber-700` | `bg-amber-500/20 text-amber-300` |
| Error | `bg-rose-100 text-rose-700` | `bg-rose-500/20 text-rose-300` |

---

## Color System

### Background Levels

```tsx
// Subtle content background
"bg-background-tertiary/20"  // Very subtle
"bg-background-tertiary/30"  // Subtle
"bg-background-tertiary/50"  // More visible

// Accent backgrounds (for highlighted content)
"bg-prmx-cyan/5"      // Very subtle cyan
"bg-emerald-500/5"    // Very subtle green
"bg-amber-500/5"      // Very subtle warning
"bg-rose-500/5"       // Very subtle error
```

### Borders

```tsx
// Section dividers
"border-b border-border-primary/50"  // Header dividers
"border-t border-border-primary/30"  // Content section dividers
"border border-border-primary/30"    // Subtle container borders

// AVOID: Heavy colored borders like
// ❌ "border border-prmx-cyan/30"
// ❌ "border-2 border-success/50"
```

---

## Modal Design

### Structure

```tsx
<Modal title="Modal Title" size="md">
  <div className="space-y-4">
    {/* Header with icon */}
    <div className="flex items-center gap-3 pb-4 border-b border-border-primary/30">
      <div className="w-10 h-10 rounded-lg bg-prmx-cyan/10 flex items-center justify-center">
        <Icon className="w-5 h-5 text-prmx-cyan" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          {/* Badges */}
        </div>
        <p className="text-base font-semibold truncate">Title</p>
        <p className="text-xs text-text-tertiary">Subtitle</p>
      </div>
    </div>
    
    {/* Key stats - side by side */}
    <div className="flex gap-3">
      <div className="flex-1 p-3 rounded-lg bg-background-tertiary/30">
        <p className="text-xs text-text-tertiary mb-1">Label</p>
        <p className="text-xl font-bold">Value</p>
      </div>
      {/* More stats... */}
    </div>
    
    {/* Data rows */}
    <div className="space-y-2">
      {/* Row items */}
    </div>
    
    {/* Footer section */}
    <div className="pt-3 border-t border-border-primary/30">
      {/* Footer content */}
    </div>
    
    {/* Actions */}
    <div className="flex gap-3 pt-2">
      <Button variant="secondary" className="flex-1">Cancel</Button>
      <Button variant="primary" className="flex-1">Confirm</Button>
    </div>
  </div>
</Modal>
```

---

## List Items

### Clickable Row

```tsx
<div 
  onClick={handleClick}
  className="group py-3 px-4 hover:bg-background-tertiary/30 transition-colors cursor-pointer"
>
  <div className="flex items-center gap-3">
    {/* Icon */}
    <div className="w-10 h-10 rounded-lg bg-prmx-cyan/10 flex items-center justify-center flex-shrink-0">
      <Icon className="w-5 h-5 text-prmx-cyan" />
    </div>
    
    {/* Content */}
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-sm truncate">Title</span>
        {/* Badges */}
      </div>
      <div className="flex items-center gap-3 mt-0.5 text-xs text-text-tertiary">
        {/* Inline metadata */}
      </div>
    </div>
    
    {/* Right side value */}
    <div className="text-right flex-shrink-0">
      <p className="text-lg font-bold">$100.00</p>
      <p className="text-xs text-text-tertiary">per share</p>
    </div>
    
    {/* Action or Chevron */}
    <ChevronRight className="w-4 h-4 text-text-tertiary group-hover:text-prmx-cyan group-hover:translate-x-0.5 transition-all flex-shrink-0" />
  </div>
</div>
```

---

## Empty States

```tsx
<div className="text-center py-8">
  <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-background-tertiary/50 flex items-center justify-center">
    <Icon className="w-5 h-5 text-text-tertiary" />
  </div>
  <p className="text-sm text-text-secondary">No items found</p>
  <p className="text-xs text-text-tertiary mt-0.5">Additional context here</p>
</div>
```

---

## Loading States

```tsx
{/* Spinner */}
<div className="flex items-center justify-center py-6">
  <RefreshCw className="w-5 h-5 animate-spin text-text-tertiary" />
</div>

{/* Skeleton */}
<div className="animate-pulse space-y-3">
  <div className="h-12 bg-background-tertiary/50 rounded-lg" />
  <div className="h-4 bg-background-tertiary/50 rounded w-2/3" />
</div>
```

---

## Anti-Patterns (What NOT to Do)

### ❌ Heavy Gradient Backgrounds
```tsx
// DON'T
<div className="bg-gradient-to-br from-slate-900/50 via-slate-800/30 to-slate-900/50">

// DO
<div className="bg-background-tertiary/30">
```

### ❌ Colored Borders
```tsx
// DON'T
<div className="border border-prmx-cyan/30">
<div className="border-2 border-success/50">

// DO
<div className="border border-border-primary/30">
```

### ❌ Large Rounded Corners
```tsx
// DON'T
<div className="rounded-xl">
<div className="rounded-2xl">

// DO
<div className="rounded-lg">
```

### ❌ Heavy Icon Containers
```tsx
// DON'T
<div className="w-14 h-14 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 border border-cyan-500/30">

// DO
<div className="w-10 h-10 rounded-lg bg-prmx-cyan/10">
```

### ❌ Redundant Information
```tsx
// DON'T - Same info twice
<p>Policy #0x08c23f990...</p>
<p>Policy #0x08c23f990801ffcebd01ba507</p>

// DO - Meaningful hierarchy
<p className="font-semibold">Manila</p>
<p className="text-xs text-text-tertiary font-mono">08c23f99...</p>
```

### ❌ Card-Heavy Layouts
```tsx
// DON'T - Grid of boxes for simple data
<div className="grid grid-cols-4 gap-3">
  <div className="p-4 rounded-xl bg-background-tertiary/50">
    <p className="text-xs">Label</p>
    <p className="text-lg font-bold">Value</p>
  </div>
  {/* More boxes... */}
</div>

// DO - Compact rows
<div className="space-y-2">
  <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20">
    <span className="text-sm text-text-secondary">Label</span>
    <span className="text-sm font-semibold">Value</span>
  </div>
</div>
```

---

## Quick Reference

### Standard Classes

| Element | Classes |
|---------|---------|
| Card header | `px-5 py-4 border-b border-border-primary/50` |
| Card content | `p-5` |
| Data row | `flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/20` |
| Icon box (sm) | `w-8 h-8 rounded-lg bg-{color}/10 flex items-center justify-center` |
| Icon box (md) | `w-10 h-10 rounded-lg bg-{color}/10 flex items-center justify-center` |
| Section divider | `pt-3 border-t border-border-primary/30` |
| Badge | `text-[10px] font-bold px-1.5 py-0.5 rounded uppercase` |
| Clickable row | `py-3 px-4 hover:bg-background-tertiary/30 transition-colors cursor-pointer` |

---

*This document should be referenced when building any new UI components or updating existing ones. The V3 Policy Detail page (`/v3/policies/[id]/page.tsx`) serves as the canonical reference implementation.*

