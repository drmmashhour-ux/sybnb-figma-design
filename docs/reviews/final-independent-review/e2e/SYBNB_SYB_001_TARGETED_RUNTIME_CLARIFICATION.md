# SYBNB — SYB-001 Targeted Clarification

**Baseline:** `6e8b8f2` · **Date:** 2026-07-23
**Authorized under:** *SYBNB Static and Runtime Review Governance — Owner Decision*, category **F** of the traceability matrix.
**Scope:** one narrow, read-only verification. No remediation. No infrastructure. No changes to frozen artifacts.

---

## Verdict

# SYB-001 — CONFIRMED WITH CLARIFICATION

**SYB-001 is accurate as written.** The listing detail page renders no date picker, never calls
`setDateRange`, and never reads `disabledDates`. Every element of the static finding is verified below.

**The clarification is about the runtime observation, not the finding.** The calendar the client agent
used was the **search bar**, which is a different component on a different screen. The past date it
produced reaches the listing page through a persisted draft, not through any control on the listing page.
The two statements were never in conflict — they describe two different surfaces.

**One fact emerged that strengthens SYB-001 beyond its original wording.** SYB-001 says `disabledDates`
is never *read on the listing page*. It is in fact never *passed by any caller anywhere in the
application*. The availability-blocking mechanism is dead end-to-end, not merely unwired on one page.

---

## Question 1 — Does the listing page contain an interactive date picker?

**No.** `src/modules/listings/ListingDetailPage.tsx`, 1 file, counted at baseline `6e8b8f2`:

| Probe | Count |
|---|---|
| `<input>` elements of any kind | **0** |
| `type="date"` | **0** |
| `onChange` handlers | **0** |
| `<DateRangePicker` render sites | **0** |
| `setDateRange(` call sites | **0** |
| `disabledDates` references | **1** — its own `useState` declaration, line 217 |

There is no control of any kind on this page through which a user can alter the dates. `dateRange` is
initialised once and never reassigned; `disabledDates` is initialised to an empty `Set` and never read.

### The trap that makes this finding easy to get wrong

`ListingDetailPage.tsx:22` reads:

```ts
import { isValidDate, nightsBetween, type DateRange } from '../search/DateRangePicker'
```

This is the file's only occurrence of the string `DateRangePicker`, and it imports **two date utilities
and a type** — not the component. Anyone verifying SYB-001 by searching for `DateRangePicker` will find
this line and conclude a picker is present. It is not. Only a search for the JSX form `<DateRangePicker`
distinguishes the two, and that search returns zero on this file.

---

## Question 2 — Which interface allowed 1 July to be selected when the test date was 23 July?

**`src/modules/search/UnifiedSearchBar.tsx:519`** — the search bar's calendar. It is the **only**
`<DateRangePicker` render site in the entire application:

```tsx
{openCalendar ? (
  <DateRangePicker
    lang={lang}
    value={{ checkIn: value.checkIn, checkOut: value.checkOut }}
    onChange={(range) => update(range)}
    onClose={() => setOpenCalendar(false)}
  />
```

### How that date reaches the listing page

`ListingDetailPage.tsx:214-215`:

```ts
const [dateRange, setDateRange] = useState<DateRange>(
  bookingDraft.dateRange || loadSearchDatesDraft() || defaultStayDateRange(),
)
```

`loadSearchDatesDraft` is exported from `UnifiedSearchBar.tsx:64`. Its own source comment states the
design intent plainly:

> Lets a listing page pre-fill the dates the guest already picked on the search page, instead
> of asking them to choose the same check-in/check-out again.

So the absence of a picker on the listing page is **deliberate**, not an omission. The listing page is
designed to inherit dates from search. The client agent's observation and SYB-001 are both correct and
describe adjacent halves of the same flow.

### Why the search calendar permitted a past date

`DateRangePicker.tsx` has **0** occurrences of `type="date"` and **0** `min=` attributes. Its only
mechanism for blocking a day is the optional `disabledDates` prop (line 15, consumed at lines 124–188).
There is no notion of "today" in the component at all — no `new Date()` comparison, no past-day guard.
Any day the calendar renders is selectable.

---

## Question 3 — Does the selected past date reach the booking API unchanged?

**Yes.** Nothing between the calendar and the database inspects the date against the present.

**Client side.** The listing page has no `onChange`, no validation, and no `setDateRange` call. The value
loaded from the search draft is carried through untouched.

**Server side.** `server/routes/bookings.mjs:472-478` is the complete date validation for booking creation:

```js
const checkIn = body.checkIn ? new Date(body.checkIn) : undefined
const checkOut = body.checkOut ? new Date(body.checkOut) : undefined
if ((checkIn && Number.isNaN(checkIn.getTime())) || (checkOut && Number.isNaN(checkOut.getTime())) || (checkIn && checkOut && checkOut <= checkIn)) {
  const error = new Error('Booking dates must be valid and check-out must be after check-in.')
  error.statusCode = 400
  error.code = 'BOOKING_DATES_INVALID'
```

Three conditions only: check-in parseable, check-out parseable, check-out after check-in. A past date
satisfies all three. Searching `bookings.mjs` for any past-date guard (`past`, `isBefore`, `< now`,
`<= now`, `startOf('day')`) returns **0 matches**. `BOOKING_DATES_INVALID` and `BOOKING_DATES_UNAVAILABLE`
are the only two date-related error codes in the file; neither concerns the present date.

### On not issuing a fresh live request

I did not create another past-dated booking to demonstrate this. One already exists in the recorded
runtime evidence (E2E-12), and every booking created enters `PAYMENT_PENDING`, which E2E-02 / B-03
established is **absorbing** — no role and no job can exit it. A new booking would add another
permanently unreleasable record to the set the owner is already deciding how to clear under **XE-4**,
in exchange for re-proving something the code path settles unambiguously. The trade was not worth it.

**Q3 is therefore answered from the code path plus the already-recorded runtime observation, not from a
new live request.** Stated so the basis of the answer is not overstated.

---

## Question 4 — Does SYB-001 remain accurate?

**Accurate, and it understates one point.**

| SYB-001 claim | Status |
|---|---|
| The listing page renders no date picker | **Verified** — 0 `<input>`, 0 `<DateRangePicker` |
| `setDateRange` is never called | **Verified** — 0 call sites |
| `disabledDates` is never read | **Verified, and broader than stated** — see below |

### The availability mechanism is dead application-wide

`grep -rn "disabledDates=" src/` returns **nothing**. No caller anywhere passes the prop.

The consequence is a clean split, and it is the sharpest way to state the defect:

| Component | Computes availability? | Renders a picker? |
|---|---|---|
| `ListingDetailPage` | **Yes** (`setDisabledDates`, 2 sites) | **No** (0) |
| `UnifiedSearchBar` | **No** (0) | **Yes** (1) |

**The page that knows which dates are unavailable has no calendar. The calendar has no idea which dates
are unavailable.** The blocking logic inside `DateRangePicker` (lines 124–188) is fully implemented and
has never executed against a non-empty set.

### Relationship to E2E-12

E2E-12 ("No date validation", High) is **not** a duplicate of SYB-001 and should not be merged into it.

- **SYB-001** is the missing *client* surface — no picker, no availability, on the listing page.
- **E2E-12** is the missing *server* guard — the API accepts past, absent, 500-year and $273 M values.

They are independent. Fixing either alone leaves the other open: a corrected calendar still faces an API
that accepts anything, and a validating API still leaves the listing page unable to show availability.
This clarification supplies the reason both are needed, and nothing here closes, merges, or reprioritises
either finding.

---

## Method and limits

- **Read-only.** No file was modified. No service was started. No booking, request or record was created.
- **No R2 connection. No email provider. No infrastructure created.** As instructed.
- All counts are from the working tree at `6e8b8f2`, the same baseline as the static and runtime registers.
- JSX render sites were counted as `<DateRangePicker` specifically, to avoid the import-line trap in Q1.
- Q1, Q2 and Q4 rest on direct file evidence. **Q3 rests on the code path plus prior recorded runtime
  evidence**, not on a new live request — stated in full above.
- **Nothing here alters SYB-001, E2E-12, the traceability matrix, Session 01, or any frozen artifact.**
  Category **F** of the traceability matrix may now be read as resolved to *confirmed with clarification*;
  making that edit is the owner's call, not mine.
