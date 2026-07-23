# SYBNB — R2 Data Residency Owner Decision Brief (U1)

**Date:** 2026-07-22
**Status:** **DECIDED — Option A adopted.** Decision brief; **no buckets created, no tokens created, no code written, no dependencies installed.**
**Resolves:** ADR-0010 unresolved decision **U1**

> ### Owner decision — 2026-07-22
>
> **Option A adopted: Cloudflare R2 European Union jurisdiction (`jurisdiction = eu`), applied
> consistently to all six approved buckets.**
>
> Explicitly rejected: automatic placement · `wnam` · `enam` · mixed EU and standard-placement buckets ·
> FedRAMP jurisdiction.
>
> The analysis in §1–§14 is left **exactly as written** so the basis for the decision remains auditable.
>
> **This is a technical infrastructure decision only.** It is not a legal conclusion regarding GDPR
> applicability, Canadian privacy obligations, Syrian privacy or data-localization requirements,
> international data transfers, sanctions or export-control compliance, or Cloudflare/Vercel eligibility
> to serve users located in Syria. Those remain separate launch gates, tracked in
> `SYBNB_EXTERNAL_VERIFICATION_LAUNCH_GATES.md`.
>
> **Bucket names (U2 resolved):** `sybnb-test-media`, `sybnb-test-documents`, `sybnb-staging-media`,
> `sybnb-staging-documents`, `sybnb-production-media`, `sybnb-production-documents` — the `production`
> spelling supersedes the `prod` abbreviation used in the appendix below.
>
> **Deployment-region dependency (§9) is now a tracked open item**, analysed in
> `SYBNB_PERSISTENT_OBJECT_STORAGE_IMPLEMENTATION_PLAN.md` §14. No region will be changed without
> explicit owner approval.
**Sources:** current official Cloudflare documentation, fetched 2026-07-22 — cited inline and listed in §14. Nothing in this brief is written from memory.

> **This document contains no credentials.**
> **This document makes no legal conclusions.** It sets out what Cloudflare currently offers and which
> questions require your counsel. Where a question is legal, it is marked as such and left open.

---

## 1. Decision required

**Choose the data location for the six R2 buckets — specifically for the two `documents` buckets, which will hold host and guest identity documents.**

This is the last blocker on ADR-0010's implementation gate. It is asked separately from every other
decision for one reason:

> **Location hints cannot be changed after bucket creation.** Cloudflare: *"Location Hints are only honored the first time a bucket with a given name is created."*
> **Jurisdictions cannot be changed after bucket creation.** Cloudflare: *"Once an R2 bucket is created, the jurisdiction cannot be changed."*
> — [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)

Changing your mind later means creating new buckets and copying every object across.

### The distinction that drives this decision

Cloudflare offers **two different mechanisms**, and they are not equivalent:

| Mechanism | What it is | Strength |
|---|---|---|
| **Location hint** | A placement preference for where data is stored | **Best-effort optimization.** Not a residency guarantee |
| **Jurisdiction** | A restriction binding objects to a jurisdiction | **A guarantee** — Cloudflare: jurisdictions *"guarantee objects in a bucket are stored within a specific jurisdiction"*, intended for compliance regimes such as GDPR and FedRAMP |

If residency is a *compliance requirement*, only a jurisdiction satisfies it. If it is a *performance
preference*, a location hint is the right tool. **This brief's central question is which of those two
things SYBNB actually needs for identity documents.**

---

## 2. Current Cloudflare R2 location options

Verified against [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/) on 2026-07-22.

**Location hints — six available:**

| Code | Region |
|---|---|
| `wnam` | Western North America |
| `enam` | Eastern North America |
| `weur` | Western Europe |
| `eeur` | Eastern Europe |
| `apac` | Asia-Pacific |
| `oc` | Oceania |

**Jurisdictions — two available:**

| Code | Jurisdiction | Availability |
|---|---|---|
| `eu` | European Union | Generally available |
| `fedramp` | FedRAMP | **Enterprise customers only** |

**Finding that materially shapes this decision: there is no Canada-specific jurisdiction, and no Canada-specific location hint.** The documentation states plainly that no Canada jurisdiction option is available. The closest available options are the *North America* location hints (`wnam`, `enam`), which are best-effort and cover the United States as well as Canada.

**Default (no hint, no jurisdiction):** Cloudflare places data automatically, optimising based on where the data is first accessed.

---

## 3. EU option

**Two distinct variants — do not conflate them.**

### 3a. EU jurisdiction (`eu`) — a guarantee

- Objects are guaranteed to be stored within the European Union.
- Explicitly offered by Cloudflare for data-residency compliance regimes such as GDPR.
- **Changes the S3 endpoint.** Jurisdiction buckets use `https://<ACCOUNT_ID>.<JURISDICTION>.r2.cloudflarestorage.com` — so an EU bucket is reached at `<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`, not the standard endpoint.
- **Known feature limitation:** Cloudflare documents that **Logpush cannot interact with jurisdiction-restricted R2 resources** (a workaround via S3-compatible endpoints is noted). SYBNB does not use Logpush today, so this is currently not a constraint — but it is a permanent property of the choice.
- Set at creation via the dashboard ("Specify jurisdiction" under Location) or by connecting the S3 client to the jurisdiction endpoint.

### 3b. European location hints (`weur` / `eeur`) — a preference

- Best-effort placement in Western or Eastern Europe.
- **No residency guarantee.**
- Standard endpoint; no feature limitations.
- `eeur` is the geographically closest available option to Syria.

**Implementation consequence you should know before choosing.** ADR-0010 §12 and the R2 configuration guide define a **single** `STORAGE_S3_ENDPOINT`. If you place the `documents` buckets in the EU jurisdiction but leave `media` on the standard endpoint, the storage service needs **two endpoints — one per bucket class**. That is a small, contained change to the approved environment-variable model, but it must be decided now rather than discovered during implementation. Placing *all six* buckets in the same jurisdiction keeps a single endpoint.

---

## 4. North America / Canada-aligned option

**A Canada-aligned option in the strict sense does not exist in R2 today.**

- **No Canada jurisdiction.** Confirmed: the only jurisdictions are `eu` and `fedramp`.
- **No Canada location hint.** The available hints are `wnam` (Western North America) and `enam` (Eastern North America). Both are region-level, cover the United States as well as Canada, and are **best-effort, not guarantees**.
- **`fedramp` is not applicable** — it is a United States government compliance program, restricted to Enterprise customers, and irrelevant to a Syria-first consumer marketplace.

So the honest framing of this option is: *"a best-effort North American placement that includes the United States, with no residency guarantee and no ability to exclude US storage."* If corporate governance requires Canadian data residency specifically, **R2 cannot currently provide it**, and that requirement would have to be met by a different provider or accepted as unmet.

---

## 5. Automatic placement option

- No location hint and no jurisdiction specified.
- Cloudflare places data automatically, optimising based on where the data is first accessed.
- Standard endpoint, no feature limitations, simplest to provision.
- **No residency guarantee and no residency predictability** — placement is determined by access patterns, not by a decision you record.

The practical consequence for SYBNB: since the application will be accessed from Syria and deployed on Vercel, the resulting placement is not something you choose or can state. If anyone later asks "where are your users' identity documents stored?", the accurate answer under this option is "wherever Cloudflare placed them based on first access", which is a weak position for a platform holding government ID.

---

## 6. Benefits and risks

| Option | Benefits | Risks |
|---|---|---|
| **EU jurisdiction (`eu`)** | Only option here that *guarantees* residency; explicitly built for compliance regimes; geographically close to Syria (good latency); a clear, stateable answer to "where is our data" | Second endpoint if mixed with non-jurisdiction buckets; Logpush limitation (not currently used); irreversible; subjects data to EU regimes whose applicability is a legal question |
| **EU location hint (`weur`/`eeur`)** | Good latency to Syria; single endpoint; no feature limitations | **Not a guarantee** — cannot be relied on for a compliance claim; irreversible anyway, so it carries the cost of permanence without the benefit of certainty |
| **North America hint (`wnam`/`enam`)** | Aligns loosely with Canadian corporate domicile; single endpoint | Not a guarantee; **cannot exclude US storage**; worst latency to Syrian users; does not actually deliver "Canadian residency" |
| **Automatic** | Simplest; no decision needed now | No guarantee, no predictability, no stateable answer; still effectively irreversible for the buckets created |

**A risk that applies to every option equally:** the choice is permanent per bucket. There is no
low-commitment option — "automatic" is not a way of deferring the decision, it is a decision to have no
residency position.

---

## 7. Effect on Syrian identity documents

The `documents` buckets will hold government identity documents belonging to Syrian hosts and guests —
the most sensitive personal data the platform processes, and the data the C5 verification chain
(commit `3f7d08e`) depends on.

Factual position, independent of location choice: the buckets are fully private, no public URL exists,
and every read is authorized by the application before any storage call (ADR-0010 §9, §13). Location
choice does not weaken any of that. What location choice determines is **which legal regimes govern the
stored bytes, and what SYBNB can truthfully state to its users about where their ID is held.**

**Open legal questions — for your counsel, not answered here:**

1. Which data-protection regime governs personal data of Syrian residents processed by a Canadian-owned entity and stored in the EU, or in North America?
2. Does storing this data in the EU bring it within GDPR scope, and if so, what obligations follow?
3. Are there Syrian legal requirements regarding where citizens' identity documents may be held?
4. **Sanctions and provider terms:** Syria is subject to sanctions programs in multiple jurisdictions. Whether Cloudflare's and Vercel's current terms of service and export-compliance policies permit serving users in Syria is a question that must be verified directly with each provider and with counsel **before launch**. This brief does not research or opine on it, and it is not specific to the residency choice — but it is material to the platform as a whole and should not be discovered later.

---

## 8. Effect on Canadian corporate governance

SYBNB is Canadian-owned; its initial users are Syrian. These pull in different directions, and R2 cannot
fully satisfy the Canadian side.

- **There is no Canadian residency option in R2.** A "Canada-aligned" choice would in practice be a North American *hint* that also permits US storage and guarantees nothing.
- If a governance policy, insurer, banking partner, or future enterprise customer requires Canadian data residency, **that requirement cannot be met by R2 today** — regardless of which option you pick here. It would require a different storage provider, and ADR-0010's driver abstraction is what would make that switch a configuration change rather than a rewrite.
- Separately: the legal pages currently carry **no registered company name or address** (roadmap item B1, still open). A residency position is of limited governance value while the operating entity is not identified anywhere in the product. These two should be resolved together.

**Open question for counsel:** does any Canadian corporate, tax, or regulatory obligation attach to where
customer personal data is stored, for an entity serving non-Canadian users? Not answered here.

---

## 9. Latency considerations

**The proxy architecture makes the Vercel function region matter at least as much as the R2 location** —
a point worth making explicitly, because optimising R2 alone will not deliver the benefit.

Under ADR-0010 §D, every byte travels:

```
Syrian user ──▶ Vercel function ──▶ R2 ──▶ Vercel function ──▶ Syrian user
```

So the round trip includes **user ↔ Vercel** *and* **Vercel ↔ R2**. Choosing an EU R2 location while the
Vercel function executes in North America would leave the dominant leg unimproved.

| R2 option | Vercel ↔ R2 leg, assuming a European function region | Notes |
|---|---|---|
| `eu` jurisdiction / `eeur` / `weur` | Shortest | `eeur` is geographically closest to Syria |
| `wnam` / `enam` | Transatlantic on every image request | Poorest fit for Syrian users |
| Automatic | Unpredictable | Depends on first access |

**Recommendation regardless of the residency choice:** set the Vercel function region deliberately, in the
same broad geography as the chosen R2 location. That is a separate configuration item, not part of this
decision, and is flagged here so it is not missed.

At closed-beta scale (5–10 hosts, 20–30 guests) latency differences will not be user-visible. This matters
for the growth path, not for the beta.

---

## 10. Future expansion considerations

- **Syria-first, wider MENA later.** European placement (jurisdiction or hint) serves that trajectory better than North America on latency.
- **A future EU market** would be well served by an existing `eu` jurisdiction and awkward to retrofit — new buckets and a full object copy.
- **A future Canadian or US market** would not be blocked by an EU choice; it would raise a question about cross-border transfer, which is a legal question rather than a technical one.
- **Per-market buckets are already anticipated.** ADR-0010 §22 lists "separate regional storage" as future evolution. The bucket-per-purpose structure approved in U7 extends naturally to bucket-per-region later.
- **A hard Canadian-residency requirement in future** would require leaving R2. The driver abstraction is the mitigation, and it is exactly why ADR-0010 rejected Vercel Blob on portability grounds.

---

## 11. Migration implications

**Within this decision:** none. No bucket exists yet, so any option is free to adopt today.

**After buckets are created:** changing location or jurisdiction requires **creating new buckets and
copying every object**, because neither attribute is mutable. For the `documents` buckets that means
re-copying identity documents — a sensitive, auditable operation.

**Two Cloudflare behaviours worth knowing before provisioning:**

1. *"Location Hints are only honored the first time a bucket with a given name is created."* Deleting a bucket and recreating it with the same name may not re-apply the hint. Get the name and the location right on the first attempt — this interacts directly with the U2 name-availability check.
2. Jurisdiction changes the endpoint host, so a later jurisdiction change is an application configuration change as well as a data move.

**Unaffected by this decision:** ADR-0010 §20 stands — existing local files are neither migrated nor
deleted, and no database migration is required under any option.

---

## 12. Recommendation

**Recommended: EU jurisdiction (`eu`) for all six buckets.**

Reasoning, in order of weight:

1. **It is the only option that guarantees anything.** For government identity documents, a best-effort placement hint is not a residency position — it is an aspiration. If residency matters at all here, only a jurisdiction delivers it.
2. **Canada-aligned residency is not actually on the menu.** The apparent alternative resolves to "North America, best-effort, includes the US, guarantees nothing" — it does not deliver Canadian residency, so choosing it trades away the guarantee without buying the governance benefit.
3. **It is also the best latency choice** for Syrian users, so it does not force a trade-off between compliance posture and performance.
4. **It gives a truthful, specific answer** to "where are our users' identity documents stored?" — which matters for a platform whose current roadmap is largely about not overstating what it can prove.
5. **Applying it to all six buckets keeps a single endpoint**, avoiding the per-class endpoint change described in §3.

**What this recommendation costs you:** the Logpush limitation (not currently relevant — SYBNB does not
use it) and the permanence of the choice.

**What would change this recommendation:** a decision by your counsel that bringing Syrian user data
within EU regimes is undesirable, or a governance requirement for North American storage. Both are legal
and business judgements outside what a technical brief should decide — which is why this is a
recommendation and not a choice.

**Secondary recommendation, if the EU jurisdiction is rejected:** `eeur` location hint for all six
buckets — best latency to Syria, single endpoint, no feature limitations, while being explicit in your
records that it is *not* a residency guarantee. **Automatic placement is not recommended**, because it
carries the same permanence as the other options while delivering no residency position at all.

---

## 13. Exact owner choice required

**Choose exactly one, and confirm whether it applies to all six buckets or only the `documents` pair:**

- [ ] **Option A — EU jurisdiction (`eu`), all six buckets.** *(Recommended.)* Guarantees EU storage; single endpoint `<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`; accepts the Logpush limitation.
- [ ] **Option B — EU jurisdiction (`eu`) for `documents` only; standard placement for `media`.** Guarantee where it matters most. **Requires a per-bucket-class endpoint change to the approved environment-variable model (§3).**
- [ ] **Option C — `eeur` location hint, all six buckets.** Best latency; explicitly **not** a guarantee.
- [ ] **Option D — `weur` location hint, all six buckets.** Western Europe; explicitly **not** a guarantee.
- [ ] **Option E — `enam` or `wnam` location hint, all six buckets.** North American, best-effort, includes US storage; does **not** deliver Canadian residency; poorest latency for Syrian users.
- [ ] **Option F — Automatic placement.** No hint, no jurisdiction, no residency position. *(Not recommended.)*

**Also confirm:**

- [ ] Whether the two open legal questions in §7 and §8 will be taken to counsel **before** provisioning, or whether provisioning proceeds and the legal review runs in parallel.
- [ ] The Vercel function region (§9), so it is chosen in the same geography rather than left at a default.

**After this choice, the ADR-0010 implementation gate has three remaining preconditions:** test buckets
created (with the U2 name-availability check), scoped test credentials injected securely, and the gate
explicitly reopened.

---

## 14. Sources

All fetched from official Cloudflare documentation on 2026-07-22:

- [R2 — Data location (location hints and jurisdictions)](https://developers.cloudflare.com/r2/reference/data-location/)
- [R2 — Create new buckets (naming rules)](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [R2 — S3 API compatibility (endpoint format, region `auto`)](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 — Public buckets (private by default)](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [Cloudflare API — R2 Buckets (account-scoped bucket paths)](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/list/)

**Accuracy note:** bucket-name scope is stated in §U2 follow-up below as *account-scoped*. This is
**inferred** from the API path structure `/accounts/{account_id}/r2/buckets/{bucket_name}` rather than
from an explicit statement in the documentation, and is flagged as inference rather than asserted as
documented fact.

---

## Appendix — U2 bucket-name availability (informational)

You approved `sybnb-production-*` for production; ADR-0010 and the configuration guide currently record
`sybnb-prod-*`. **Your naming is authoritative** — this is noted so the two documents can be reconciled
when the ADR is next updated, rather than silently diverging.

Approved names, checked against Cloudflare's documented naming rules (lowercase letters, digits and
hyphens; no leading or trailing hyphen; 3–63 characters):

| Bucket | Length | Rule-compliant |
|---|---|---|
| `sybnb-test-media` | 16 | Yes |
| `sybnb-test-documents` | 20 | Yes |
| `sybnb-staging-media` | 19 | Yes |
| `sybnb-staging-documents` | 23 | Yes |
| `sybnb-production-media` | 22 | Yes |
| `sybnb-production-documents` | 26 | Yes |

All six are valid. Bucket names appear to be **account-scoped rather than globally unique** (see the
accuracy note in §14), so a collision is only possible with an existing bucket in your own account —
which is checkable at provisioning time and, if it occurs, is a conflict you can see directly. **No
alternative names are proposed, because none are needed unless a collision appears in your account.** If
one does, it will be reported and approval requested before anything is created.
