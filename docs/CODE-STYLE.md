# Code Style Rules

## Indentation
- **Always use tabs**, never spaces.

## Units
- **Prefer `rem` over `px`** for sizing, spacing, font sizes, and layout values.
- Exception: **borders of 1–5px** may stay in `px` (e.g. `border-1`, `border-2`, `border-[3px]`).
- Exception: very small pixel-precise values where `rem` would be awkward (e.g. `1px` box shadows, `2px` outlines).

## Tailwind
- Use Tailwind utility classes as the primary styling approach.
- For arbitrary values, prefer `rem`-based where Tailwind's scale doesn't cover it (e.g. `w-[14rem]` not `w-[224px]`).
- Border widths in `px` are fine (`border`, `border-2`, `border-[3px]`).

## Vue SFCs
- Use `<script setup>` composition API style.
- Keep `<script setup>` before `<template>` before `<style>`.
