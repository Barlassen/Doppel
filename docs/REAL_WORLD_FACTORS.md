# Swiss Real-World Factors: Sourced Parameters and Engine Design Proposal

This document has two parts:

1. **Part 1** compiles citable Swiss parameters across six domains that affect household wealth over a 15–60 year horizon: macroeconomic regimes, children and tertiary education, car ownership vs. public transit, mandatory health insurance, climate and energy transition, and other high-impact Swiss household factors (rent indexation, AHV/BVG reforms, and old-age care).
2. **Part 2** proposes how to incorporate these factors into Doppel's deterministic Monte Carlo engine (`src/lib/finance/`), intent parsers (`src/lib/twin/`), UI disclosures (`src/components/`), onboarding wizard (`src/lib/accounts/`), and Kotlin Multiplatform port (`pocket/`), in four incremental phases.

**Conventions:**
- Every table row includes `Value | Unit | Year | Source | URL | Accessed`.
- Access date for all web lookups in this document is `2026-11-22`.
- Where an exact single official figure could not be verified, the row states `no source found` rather than inventing a number.
- Estimates and scenario ranges (as opposed to official legal/statistical figures) are explicitly marked `[estimate]` or `[scenario range]`.
- No code in `src/` or `pocket/` is changed by this document.

---

## Current Engine Baseline

Today (`src/lib/finance/monteCarlo.ts`, `src/lib/finance/swissRules.ts`, `src/lib/finance/pension.ts`), the simulator makes the following simplifying assumptions:

- **Constant macro parameters** (`ASSUMPTIONS` in `monteCarlo.ts`): inflation `1.2%/yr`, nominal wage growth `1.2%/yr` (0% real wage growth), yearly real wage volatility `1.0%`, equities `6.5% ± 16%`, bonds `2.0% ± 5%`, cash `0.3%`, residential property `1.5% ± 5%`, BVG interest `1.25%/yr`, crash shock `−30%`, unemployment replacement `70%` capped at CHF `148,200/yr`.
- **Constant mortgage rates** (`swissRules.ts`): `1.8%` actual mortgage rate in cash flow for the entire horizon; `5.0%` stress rate, `1.0%` maintenance, 15-year amortisation to `2/3` loan-to-value, `1/3` gross-income cap in `tragbarkeit()`.
- **Flat child cost** (`monteCarlo.ts:157`, `actions.ts:82–86`): a `child` event is a flat monthly amount (default CHF `1,500/mo`) indexed to general CPI for `216` months (18 years), with no daycare spike, no family allowances, no child tax deductions, and no post-18 university or apprenticeship phase.
- **No car, health-premium drift, rent-reference-rate, climate/heating, or old-age care modelling.** All non-housing spending and rent grow uniformly at `1.2%/yr` (`priceIdx[m]`).
- **Built-in profiles** (`src/lib/data/profiles.ts`): Barlas (age 24, Zürich ZH, CHF 66,000 gross, rent CHF 1,520/mo, health insurance CHF 318/mo, ZVV CHF 88/mo), Meriç (age 27, Lausanne VD, CHF 92,000 gross, rent CHF 1,690/mo, health insurance CHF 428/mo, Mobilis CHF 74/mo, planned CHF 540,000 flat in Renens at month 60), and Oktay (age 26, Basel BS, CHF 72,000 gross, rent CHF 1,640/mo, health insurance CHF 372/mo, U-Abo CHF 80/mo). None currently owns a car or has children.

---

## Part 1: Sourced Swiss Parameters

### 1.1 Economy, Inflation, Wages, and Mortgage Rates

| Parameter | Value | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| SNB policy rate | 0.00 | % p.a. | 2025–2026 (since Jun 2025) | Swiss National Bank (SNB) | https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy | 2026-11-22 |
| SARON compounding baseline | −0.04 to 0.00 | % p.a. | 2026 | SNB / market overview | https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy | 2026-11-22 |
| SNB sight-deposit tiering discount above threshold | 0.25 | pp below policy rate | 2026 | SNB | https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy | 2026-11-22 |
| SNB price-stability ceiling | < 2.0 | % CPI YoY | Ongoing | SNB | https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy | 2026-11-22 |
| SNB conditional inflation forecast (2026 / 2027) | 0.7 / 0.8 | % CPI annual avg | 2026–2027 | SNB Monetary Policy Assessment | https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy | 2026-11-22 |
| SECO real GDP growth (sporting-event adj.) | 1.8 (2025) / 1.7 (2026f) | % YoY | 2025–2026 | SECO Expert Group on Business Cycles | https://www.seco.admin.ch/seco/en/home/wirtschaftslage---wirtschaftspolitik/Wirtschaftslage/konjunkturprognosen.html | 2026-11-22 |
| SECO CPI inflation forecast | 0.6 | % annual avg | 2026 | SECO | https://www.seco.admin.ch/seco/en/home/wirtschaftslage---wirtschaftspolitik/Wirtschaftslage/konjunkturprognosen.html | 2026-11-22 |
| SECO unemployment rate | 2.8 (2025) / 3.1 (2026f) | % annual avg | 2025–2026 | SECO | https://www.seco.admin.ch/seco/en/home/wirtschaftslage---wirtschaftspolitik/Wirtschaftslage/konjunkturprognosen.html | 2026-11-22 |
| Realized Swiss CPI inflation (2025) | 0.2 | % annual avg | 2025 | BFS (CPI / LIK) | https://www.bfs.admin.ch/bfs/en/home/statistics/prices/consumer-price-index.html | 2026-11-22 |
| Nominal / real wage growth (2025) | +1.8 / +1.6 | % YoY | 2025 | BFS Swiss Wage Index (`je-e-03.04.03.02.01`) | https://www.bfs.admin.ch/bfs/en/home/statistics/work-income/wages-income-employment-labour-costs/wage-evolution.html | 2026-11-22 |
| Multi-decade arithmetic average real wage growth (1994–2025) | no source found (compute from BFS table `je-e-03.04.03.02.01`; qualitatively < 1%/yr) | % p.a. | 1994–2025 | BFS Swiss Wage Index | https://www.bfs.admin.ch/bfs/en/home/statistics/work-income/wages-income-employment-labour-costs/wage-evolution.html | 2026-11-22 |
| Historical CPI peak — 1970s oil shock (1974) | 9.77 | % annual avg | 1974 | FRED / BFS CPI series | https://fred.stlouisfed.org/ | 2026-11-22 |
| Historical CPI peak — early 1990s (1991) | 5.86 | % annual avg | 1991 | FRED / BFS CPI series | https://fred.stlouisfed.org/ | 2026-11-22 |
| Historical CPI — modern low-inflation benchmark (2000) | 1.56 | % annual avg | 2000 | FRED / BFS CPI series | https://fred.stlouisfed.org/ | 2026-11-22 |
| Historical SNB negative-rate regime (Jan 2015 – Sep 2022) | −0.75 | % policy rate | 2015–2022 | SNB | https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy | 2026-11-22 |
| Historical Swiss mortgage rate peak (early 1990s) | ~7.0 | % p.a. | Early 1990s | SNB / Swiss market history | https://www.snb.ch/en/ | 2026-11-22 |
| 10-year fixed mortgage market rate (typical range / avg) | 1.55–2.15 (avg ~1.80–1.85) | % p.a. | 2026 | Comparis / Resolve (Swiss market) | https://www.comparis.ch/hypotheken | 2026-11-22 |
| SARON mortgage lender margin (added to SARON, floored at 0%) | 0.70–1.20 | % p.a. | 2026 | Comparis (Swiss market) | https://www.comparis.ch/hypotheken | 2026-11-22 |
| Regulatory mortgage rules (hard equity / amortisation / stress rate / cap) | ≥10% hard equity (20% total); amortise to 2/3 in ≤15 yr; ~4.5–5% stress rate; 1% upkeep; ≤1/3 gross income | regulatory minimum | 2025–2026 | Swiss Bankers Association (SBA) / FINMA | https://www.swissbanking.ch/en/services/library/guidelines | 2026-11-22 |

**Notes:**
- The current engine's `ACTUAL_MORTGAGE_RATE = 0.018` matches the 2026 10-year fixed average closely, but ignores both SARON mortgages (~0.70–1.20% at 0% SNB rate) and refinancing risk if rates move back toward 3–5% (or the 1990s 7% tail).
- Switzerland's 1974 (9.77%), 1991 (5.86%), 2000 (1.56%), and 2015–2022 (−0.75% policy rate, near-zero CPI) episodes provide concrete empirical anchors for a 3-state macro regime model.

---

### 1.2 Children, Childcare (Kita), Allowances, Taxes, and Tertiary Education

#### Direct child costs and childcare

| Parameter | Value | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| BFS direct incremental cost — 1 child (couple household, excl. Kita) | 819 | CHF/month | 2015–2017 HABE baseline (published in *BFS Aktuell*) | BFS (Haushaltsbudgeterhebung HABE) | https://www.bfs.admin.ch/bfs/en/home/statistics/economic-social-situation-population/income-consumption-wealth/household-budget.html | 2026-11-22 |
| BFS direct incremental cost — 2 children total (couple household, excl. Kita) | 1,310 (~655/child) | CHF/month | 2015–2017 HABE baseline | BFS (HABE) | https://www.bfs.admin.ch/bfs/en/home/statistics/economic-social-situation-population/income-consumption-wealth/household-budget.html | 2026-11-22 |
| Full-allocation child cost — age 0–4 (excl. Kita) | ~1,300–1,400 `[estimate]` | CHF/month | Pre-2026 benchmark | Swiss youth-welfare / bank summaries citing Zürcher Tabellen & BFS | https://www.zh.ch/de/familie/unterhalt/kinderkosten.html | 2026-11-22 |
| Full-allocation child cost — age 5–12 (excl. Kita) | ~1,450–1,600 `[estimate]` | CHF/month | Pre-2026 benchmark | Swiss youth-welfare / bank summaries citing Zürcher Tabellen & BFS | https://www.zh.ch/de/familie/unterhalt/kinderkosten.html | 2026-11-22 |
| Full-allocation child cost — age 13–18 (excl. Kita) | ~1,750–1,900 `[estimate]` | CHF/month | Pre-2026 benchmark | Swiss youth-welfare / bank summaries citing Zürcher Tabellen & BFS | https://www.zh.ch/de/familie/unterhalt/kinderkosten.html | 2026-11-22 |
| Status of *Zürcher Kinderkosten-Tabelle* | Discontinued per 2026 (BGE 147 III 265 requires individual calculation) | legal status | 2026 | Canton of Zürich (AJB) | https://www.zh.ch/de/familie/unterhalt/kinderkosten.html | 2026-11-22 |
| Private unsubsidised Kita (daycare) full-rate tariff | 110–150 (~2,200–3,100/mo at 5 days/wk) | CHF/day | 2025–2026 | Swiss daycare market summaries | https://www.stadt-zuerich.ch/ssd/de/index/volksschule/kinderbetreuung.html | 2026-11-22 |
| City of Zürich subsidised Kita parental contribution | 12 (min, 0% factor) to 120 (max) | CHF/day | 2025–2026 | City of Zürich (*Beitragsfaktor* regulation) | https://www.stadt-zuerich.ch/ssd/de/index/volksschule/kinderbetreuung.html | 2026-11-22 |
| City of Geneva (*Ville de Genève*) subsidised crèche tariff | Income-graded (*Barèmes A/B* on *avis de taxation*; CHF 10,000 deduction from 3+ dependents; exact CHF/day table varies by bracket) | CHF/day (sliding scale) | 2025–2026 | Ville de Genève (BIPE) | https://www.geneve.ch/themes/petite-enfance | 2026-11-22 |

**Important modelling distinction:** BFS HABE measures *incremental* direct cash spending added by a child (CHF 819/mo for the first child, CHF 491/mo for the second) because housing and fixed household costs are shared, whereas the historical Zürcher Tabellen (CHF 1,300–1,900/mo) allocated a full per-capita share of rent and utilities. Because Doppel already models the household's rent/mortgage separately, using the Zürcher full-allocation figure on top of existing rent would double-count housing unless the user moves to a larger home.

#### Family allowances (*Familienzulagen*, BSV 2025/2026)

Federal statutory minima were raised on 1 January 2025 (first increase since 2009) and remain unchanged for 2026. Entitlement requires an AHV-insured salary of at least CHF 630/month (CHF 7,560/year). The governing canton is the employer's FAK canton, not the canton of residence.

| Parameter / Canton | Kinderzulage (age 0–16) | Ausbildungszulage (age 16–25 in education) | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Federal minimum (FamZG Art. 5) | 215 | 268 | CHF/month | 2025–2026 | BSV / FSIO | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |
| Zürich (ZH) — *Barlas* | 215 | 268 | CHF/month | 2025–2026 | BSV / cantonal FAK | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |
| Vaud (VD) — *Meriç* | 322 | 425 | CHF/month | 2025–2026 | BSV / cantonal FAK | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |
| Basel-Stadt (BS) — *Oktay* | 275 | 325 | CHF/month | 2025–2026 | BSV / cantonal FAK | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |
| Geneva (GE) | 311 | 415 | CHF/month | 2025–2026 | BSV / cantonal FAK | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |
| Bern (BE) | 250 | 310 | CHF/month | 2025–2026 | BSV / cantonal FAK | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |
| Zug (ZG) | 330 | 330 | CHF/month | 2025–2026 | BSV / cantonal FAK | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |
| Valais (VS) — highest nationwide | 327 | 477 | CHF/month | 2025–2026 | BSV / cantonal FAK | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |
| Other 19 cantons (AG, AI, AR, BL, FR, GL, GR, JU, LU, NE, NW, OW, SG, SH, SO, SZ, TG, TI, UR) | 215–275 | 268–325 | CHF/month | 2025–2026 | BSV (*Arten und Ansätze der Familienzulagen*) | https://www.bsv.admin.ch/bsv/de/home/sozialversicherungen/fam.html | 2026-11-22 |

*(Full 26-canton exact figures retrieved: AG 225/278, AR 230/280, AI 245/298, BL 215/268, BS 275/325, BE 250/310, FR 265/325, GE 311/415, GL 215/268, GR 240/290, JU 275/325, LU 215/268, NE 240/320, NW 258/311, OW 220/270, SH 230/290, SZ 230/280, SO 215/268, SG 245/298, TI 215/268, TG 215/280, UR 240/290, VD 322/425, VS 327/477, ZG 330/330, ZH 215/268. Note: several cantons pay higher amounts from the 3rd child onward.)*

#### Child and childcare tax deductions

| Parameter | Value | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Federal income deduction per child (DBG) | 6,800 | CHF/year | 2025–2026 | ESTV / DBG | https://www.estv.admin.ch/estv/de/home/direkte-bundessteuer.html | 2026-11-22 |
| Federal direct tax-credit reduction per child (Elterntarif) | 263 | CHF/year (off tax owed) | 2025–2026 | ESTV / DBG | https://www.estv.admin.ch/estv/de/home/direkte-bundessteuer.html | 2026-11-22 |
| Federal childcare deduction cap (age < 14, DBG) | 25,800 (25,900 from 2027) | CHF/year | 2025–2026 | ESTV / DBG | https://www.estv.admin.ch/estv/de/home/direkte-bundessteuer.html | 2026-11-22 |
| Canton Zürich child deduction / childcare cap | 9,400 / 25,000–25,800 | CHF/year | 2025–2026 | Canton Zürich tax administration | https://www.zh.ch/de/steuern-finanzen/steuern.html | 2026-11-22 |
| Canton Basel-Stadt child deduction / childcare cap | 8,600 / 26,000 | CHF/year | 2025–2026 | Steuerverwaltung Basel-Stadt | https://www.steuerverwaltung.bs.ch/ | 2026-11-22 |
| Canton Geneva childcare deduction cap | 25,000–26,320 | CHF/year | 2025–2026 | AFC Genève | https://www.ge.ch/impots | 2026-11-22 |
| Canton Geneva / Canton Vaud flat child income deduction | no source found (VD uses a family quotient system; GE uses tiered social deductions/splitting rather than a single flat CHF figure) | — | 2025–2026 | ACI Vaud / AFC Genève | https://www.vd.ch/themes/etat-droit-finances/impots | 2026-11-22 |

#### University, Universities of Applied Sciences (FH/PH), and Apprenticeships

| Parameter | Value | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| ETH Zürich / EPFL tuition — Swiss & Swiss-Matura residents (Group 1) | 730 | CHF/semester | From Autumn 2025 | ETH Zürich / EPFL / ETH Board | https://ethz.ch/students/en/studies/financial/tuition-fees.html | 2026-11-22 |
| ETH Zürich / EPFL tuition — international students (Group 2, tripled) | 2,190 | CHF/semester | From Autumn 2025 | ETH Zürich / EPFL / ETH Board | https://ethz.ch/students/en/studies/financial/tuition-fees.html | 2026-11-22 |
| Cantonal university tuition (UZH / UNIL, domestic) | ~770 (UZH) / ~580 (UNIL) | CHF/semester | 2025–2026 | UZH / UNIL | https://www.uzh.ch/ | 2026-11-22 |
| University of Applied Sciences tuition (ZHAW, domestic) | ~720 | CHF/semester | 2025–2026 | ZHAW | https://www.zhaw.ch/ | 2026-11-22 |
| Student median monthly budget / living costs (all CH / UH / FH) | 2,282 (CH) / ~2,253 (UZH) / ~2,788 (FH) | CHF/month | BFS SSEE latest | BFS (*Studien- und Lebensbedingungen*) | https://www.bfs.admin.ch/bfs/en/home/statistics/education-science/social-economic-conditions-student-life.html | 2026-11-22 |
| Student living cost guidance (living away from home) | 2,000–2,500 (rent 600–900+) | CHF/month | 2025–2026 | ETH Zürich / EPFL financial guidance | https://ethz.ch/students/en/studies/financial/tuition-fees.html | 2026-11-22 |
| Share of students working alongside studies | 73 | % | BFS SSEE latest | BFS | https://www.bfs.admin.ch/bfs/en/home/statistics/education-science/social-economic-conditions-student-life.html | 2026-11-22 |
| Share of students applying for cantonal scholarships/loans (*Stipendien*) | 27 | % | BFS SSEE latest | BFS | https://www.bfs.admin.ch/bfs/en/home/statistics/education-science/social-economic-conditions-student-life.html | 2026-11-22 |
| Upper-secondary baccalaureate rate (*Gesamtmaturitätsquote*, to age 25) | 42.9 (23.2% Gymnasiale, 15.5% Berufs-, 4.2% Fachmaturität) | % of cohort | 2022–2024 3-yr avg | BFS Bildungsindikatoren (LABB) | https://www.bfs.admin.ch/bfs/de/home/statistiken/bildung-wissenschaft/bildungsindikatoren.html | 2026-11-22 |
| Tertiary first-degree graduation rate (*Hochschulabschlussquote* UH+FH+PH) | 34.6 (women 39.1%, men 30.4%) | % of cohort | 2024 | BFS Bildungsindikatoren | https://www.bfs.admin.ch/bfs/de/home/statistiken/bildung-wissenschaft/bildungsindikatoren.html | 2026-11-22 |
| Separate UH vs. FH entry rate (*Eintrittsquote* split) | no source found (overall cohort probability bounded by 42.9% Maturitätsquote and 34.6% graduation rate) | % of cohort | — | BFS | https://www.bfs.admin.ch/bfs/de/home/statistiken/bildung-wissenschaft.html | 2026-11-22 |
| Share entering VET apprenticeship after compulsory school | ~65–70 | % of cohort | Recent BFS | BFS / SBFI | https://www.bfs.admin.ch/bfs/de/home/statistiken/bildung-wissenschaft/personen-ausbildung/sekundarstufe-II.html | 2026-11-22 |
| Bachelor completion within 3 yr / 5 yr / 8 yr (UH vs FH) | 26% / 72% / ~77–85% (UH); 40% / 78% / ~77–85% (FH) | % of entrants | BFS LABB | BFS LABB | https://www.bfs.admin.ch/bfs/de/home/statistiken/bildung-wissenschaft/uebertritte-verlaeufe-bildungsbereich.html | 2026-11-22 |
| Typical total university duration (Bachelor + Master) | 5 (3 yr BSc + 1.5–2 yr MSc; FH often 3–4 yr BSc) | years | Structural norm | swissuniversities / BFS | https://www.swissuniversities.ch/ | 2026-11-22 |
| Apprenticeship gross monthly wage (*Lehrlingslohn*, yr 1 / 2 / 3 / 4) | 750–800 / 950–1,000 / ~1,250 / 1,350–1,400 `[estimate]` | CHF/month | 2025–2026 | Yousty / Berufsberatung.ch (no statutory minimum) | https://www.berufsberatung.ch/ | 2026-11-22 |

**Key takeaway for Doppel:** Tuition in Switzerland is modest (~CHF 1,160–1,540/year for domestic students), so the real financial shock of a child attending university is **living costs** (~CHF 2,000–2,300/month if living away from home, partly offset by `Ausbildungszulage` of CHF 268–477/mo and student part-time earnings, whereas an apprentice earns CHF 750–1,400/mo from age 16 and typically reaches financial independence around age 19–20).

---

### 1.3 Car Ownership vs. Public Transit

| Parameter | Value | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TCS average car total cost per km (reference car CHF 45,000, 15,000 km/yr) | 0.74 (down from 0.76 in 2025) | CHF/km | 2026 | Touring Club Schweiz (TCS) | https://www.tcs.ch/de/testberichte-ratgeber/ratgeber/kontrollen-unterhalt/kilometerkosten.php | 2026-11-22 |
| TCS annual fixed costs (depreciation, insurance, road tax, parking/garage) | 6,977 (~581/mo) | CHF/year | 2026 | TCS | https://www.tcs.ch/de/testberichte-ratgeber/ratgeber/kontrollen-unterhalt/kilometerkosten.php | 2026-11-22 |
| TCS annual variable costs (fuel/electricity, tyres, maintenance at 15,000 km/yr) | 4,135 (~345/mo) | CHF/year | 2026 | TCS | https://www.tcs.ch/de/testberichte-ratgeber/ratgeber/kontrollen-unterhalt/kilometerkosten.php | 2026-11-22 |
| TCS total annual car cost (fixed + variable) | 11,112 (~926/mo) | CHF/year | 2026 | TCS | https://www.tcs.ch/de/testberichte-ratgeber/ratgeber/kontrollen-unterhalt/kilometerkosten.php | 2026-11-22 |
| Federal tax mileage deduction cap (private car, business use) | 0.75 (up from 0.70 in 2025) | CHF/km | 2026 | EFD (Federal Dept. of Finance) | https://www.estv.admin.ch/ | 2026-11-22 |
| Swiss passenger-car average annual mileage (by powertrain) | 9,000 (petrol) / 11,300–11,500 (EV/hybrid) / 12,800 (diesel) | km/year | Recent BFS | BFS (*Mikrozensus Mobilität und Verkehr*) | https://www.bfs.admin.ch/bfs/en/home/statistics/mobility-transport.html | 2026-11-22 |
| Average age of Swiss passenger car fleet | >10.5 (approaching 11; up from ~7 in 2005) | years | 2025–2026 | BFS (*Strassenfahrzeuge*) | https://www.bfs.admin.ch/bfs/en/home/statistics/mobility-transport/transport-infrastructure-vehicles/vehicles.html | 2026-11-22 |
| Average private-owner car replacement cycle | no source found (use BFS fleet age ~10 yr as proxy; TCS leasing terms typically 3–5 yr) | years | — | TCS / BFS | https://www.tcs.ch/de/testberichte-ratgeber/ratgeber/kontrollen-unterhalt/kilometerkosten.php | 2026-11-22 |
| TCS leasing budget rule of thumb | Down payment + all monthly instalments ≤ 50% of list price over 3–5 yr | guideline | 2025–2026 | TCS | https://www.tcs.ch/de/testberichte-ratgeber/ratgeber/kontrollen-unterhalt/kilometerkosten.php | 2026-11-22 |
| SBB Half-Fare Travelcard (*Halbtax*, adult) | 190 (until Dec 2026) / 195 (from Dec 2026) | CHF/year | 2026–2027 | SBB / Alliance SwissPass | https://www.sbb.ch/en/tickets-switzerland/travelcards/half-fare-travelcard.html | 2026-11-22 |
| SBB GA Travelcard (*Generalabonnement*, adult 2nd class) | 3,995 (until Dec 2026) / 4,095 (from Dec 2026) | CHF/year | 2026–2027 | SBB / Alliance SwissPass / SRF | https://www.sbb.ch/en/tickets-switzerland/travelcards/ga-travelcard.html | 2026-11-22 |
| SBB GA Travelcard (adult 1st class) | 6,520 (until Dec 2026) / 6,770 (from Dec 2026) | CHF/year | 2026–2027 | SBB / Alliance SwissPass | https://www.sbb.ch/en/tickets-switzerland/travelcards/ga-travelcard.html | 2026-11-22 |

**Key takeaway:** Owning one mid-size car costs ~CHF 926/month (CHF 11,112/yr) vs. CHF 341/month (CHF 4,095/yr) for a 2nd-class GA — a **CHF 585/month** (CHF 7,017/year) gap, which compounds to over CHF 200,000 over 20 years when invested.

---

### 1.4 Mandatory Health Insurance (KVG / OKP)

| Parameter | Value | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Mean monthly basic premium (all insured) | 393.30 (2026, +4.4%) / 412.00 (2027, +5.0%) | CHF/month | 2026–2027 | FOPH / BAG | https://www.bag.admin.ch/bag/en/home/versicherung/krankenversicherung.html | 2026-11-22 |
| Mean monthly basic premium — adults (26+) | 465.30 (+CHF 18.50 YoY) | CHF/month | 2026 | FOPH / BAG | https://www.bag.admin.ch/bag/en/home/versicherung/krankenversicherung.html | 2026-11-22 |
| Mean monthly basic premium — young adults (19–25) | 326.30 (+CHF 13.30 YoY) | CHF/month | 2026 | FOPH / BAG | https://www.bag.admin.ch/bag/en/home/versicherung/krankenversicherung.html | 2026-11-22 |
| Mean monthly basic premium — children (0–18) | 122.50 (+CHF 5.70 YoY) | CHF/month | 2026 | FOPH / BAG | https://www.bag.admin.ch/bag/en/home/versicherung/krankenversicherung.html | 2026-11-22 |
| BFS Health Insurance Premium Index (KVPI, basic + suppl.) YoY | +4.2% (2025, idx 222.9) / +3.3% (2026, idx 230.3; basic-only +4.3%, idx 282.0) | % YoY (1999 = 100) | 2025–2026 | BFS KVPI | https://www.bfs.admin.ch/bfs/en/home/statistics/prices/health-insurance-premium-index.html | 2026-11-22 |
| 30-year cumulative basic premium growth (1996–2026) | >207% (CHF 128 → CHF 393.30; implied CAGR **3.81%/yr**) vs. ~20% CPI (~0.61%/yr) | % cumulative (CAGR derived) | 1996–2026 | FOPH / BAG & SRF summary | https://www.bag.admin.ch/bag/en/home/versicherung/krankenversicherung.html | 2026-11-22 |
| Share of Swiss population receiving premium subsidies (IPV) | 25–28 (~2.3–2.5M persons) | % of insured | 2024–2026 | FOPH / BAG Dashboard | https://www.bag.admin.ch/bag/en/home/versicherung/krankenversicherung.html | 2026-11-22 |
| Single national IPV income threshold | no source found (thresholds and subsidy formulas are set independently by all 26 cantons) | — | — | FOPH / BAG | https://www.bag.admin.ch/bag/en/home/versicherung/krankenversicherung.html | 2026-11-22 |

**Key takeaway:** Over 30 years of KVG (1996–2026), basic health insurance premiums grew at **~3.8%/yr nominal (~3.2 pp/yr above Swiss CPI)**. Treating health premiums as growing at 1.2% CPI understates an adult's real health premium burden by ~CHF 500–800/month by retirement age 65 (and even more for a couple).

---

### 1.5 Climate Change, Energy Transition, Heating Rules, and Portfolio Risk

| Parameter | Value | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Federal CO₂ levy on thermal fossil fuels | 120 | CHF / tonne CO₂ | 2025–2026 | BAFU / FOEN | https://www.bafu.admin.ch/bafu/en/home/topics/climate.html | 2026-11-22 |
| CO₂ levy pass-through on extra-light heating oil | 31.80 | Rp./litre | 2025–2026 | BAFU / BAZG / Avenergy | https://www.bafu.admin.ch/bafu/en/home/topics/climate.html | 2026-11-22 |
| CO₂ levy pass-through on natural gas (exact official Rp/kWh) | no source found (varies by calorific value; ~2.4 Rp/kWh `[estimate]` at ~0.20 kg CO₂/kWh × CHF 120/t) | Rp./kWh | 2025–2026 | BAFU / BAZG | https://www.bafu.admin.ch/bafu/en/home/topics/climate.html | 2026-11-22 |
| CO₂ levy redistribution split | 2/3 refunded to residents (via KVG insurers) & firms; 1/3 (max CHF 450M/yr) to *Das Gebäudeprogramm* | statutory split | 2025–2026 | BAFU / BFE | https://www.dasgebaeudeprogramm.ch/ | 2026-11-22 |
| Household electricity median tariff (ElCom profile H4, 4,500 kWh/yr) | 29.00 (2025) / 27.70 (2026) / 26.50 (2027) | Rp./kWh | 2025–2027 | ElCom | https://www.strompreis.elcom.admin.ch/ | 2026-11-22 |
| Cantonal heating replacement rules (MuKEn) | Restricts/bans 1:1 replacement of end-of-life (15–20 yr) oil/gas boilers with fossil systems; mandates renewable heating (e.g., heat pump, district, wood) unless exempt | cantonal building law | Active (canton-specific adoption) | EnDK / BFE / EnergieSchweiz | https://www.bfe.admin.ch/ | 2026-11-22 |
| Heat pump retrofit gross cost (single-family home, oil/gas → heat pump) | 45,000–85,000 (air-water lower end; geothermal/probe + radiator upgrades upper end) `[estimate]` | CHF one-off | 2025–2026 | Swiss heating-retrofit market guides | https://www.dasgebaeudeprogramm.ch/ | 2026-11-22 |
| Cantonal *Gebäudeprogramm* + KIG subsidy for heat pump | Several thousand up to >25,000 (must apply before work starts) | CHF one-off grant | 2025–2026 | *Das Gebäudeprogramm* / BFE | https://www.dasgebaeudeprogramm.ch/ | 2026-11-22 |
| Swiss climate scenarios (CH2018 → Climate CH2025) | Aligns with IPCC AR6 GWLs (+1.5°C/+2°C/+3°C); Switzerland warms faster than global mean (~10–15% more warming at +3°C than prior projections); higher heavy-rain, heatwave, and dry-summer extremes | physical baseline | 2025 | MeteoSwiss / NCCS / ETH Zürich | https://www.nccs.admin.ch/nccs/en/home/climate-change-and-impacts/swiss-climate-scenarios/ch2018.html | 2026-11-22 |
| Swiss flood & landslide natural-hazard damage (1972–present) | ~17.5 billion cumulative (inflation-adj.); long-run mean ~300M/yr (highly volatile: tens of M to >1–3B in extreme years like 2005, 2021, 2024) | CHF | 1972–2024+ | WSL / BAFU Flood & Landslide Damage Database | https://www.wsl.ch/en/contexts/natural-hazards/dealing-with-natural-hazards/flood-and-landslide-damage-database/ | 2026-11-22 |
| Cantonal building insurance (GVZ / VKG) natural-hazard premium rate | no source found for single national permille rate (varies by canton, construction type, and occupancy; tenths of a permille to a few permille + 5% federal stamp duty) | ‰ of insured value | 2025–2026 | GVZ / VKG | https://www.gvz.ch/ | 2026-11-22 |
| Equity portfolio climate transition return drag (NGFS disorderly / delayed transition) | −0.3 to −0.5 (10-yr annualized for diversified equity; worse for carbon-heavy tilts) `[scenario range]` | % p.a. return drag | NGFS / institutional stress tests | Mercer / Ortec Finance citing NGFS (no official SNB/FINMA consensus drag number) | https://www.ngfs.net/ngfs-scenarios-portal/ | 2026-11-22 |

**Key takeaway:** For an individual Swiss household, the **largest direct climate-related cash-flow risk** is a mandatory fossil-heating retrofit for homeowners (net CHF 30,000–65,000 after subsidies when a 15–20 year oil/gas boiler fails under MuKEn), plus motor-insurance / property-insurance premium spikes after severe hail/flood seasons (TCS noted +14% comprehensive car-insurance premiums in 2026). Portfolio-level transition risk has no official Swiss single-point estimate and should only be modelled as an **optional stress scenario** (e.g. NGFS disorderly −0.4%/yr equity drag), not silently embedded in base returns.

---

### 1.6 Other High-Impact Swiss Household Factors Currently Missing

| Parameter | Value | Unit | Year | Source | URL | Accessed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 13th AHV pension payout | First paid Dec 2026 (annual cost CHF 4.2–5.4B; already modelled as `× 13/12` in `pension.ts`) | statutory payout | Dec 2026 | BSV / Federal Council | https://www.bsv.admin.ch/ | 2026-11-22 |
| 13th AHV pension financing vote (VAT hike 8.1% → 8.5%) | +0.4 pp VAT referendum scheduled 29 Nov 2026 (outcome pending at access date) | pp VAT | Nov 2026 | Federal Council / Parliament | https://www.admin.ch/ | 2026-11-22 |
| BVG 2nd-pillar reform (conversion rate 6.8% → 6.0%) | **Rejected** by voters in September 2024; statutory mandatory minimum stays 6.8% | referendum result | Sep 2024 | Federal Chancellery / BSV | https://www.bsv.admin.ch/ | 2026-11-22 |
| Effective blended BVG conversion rate across Swiss pension funds | ~5.3 (vs. 6.8% statutory mandatory minimum; current `pension.ts` uses 5.5%) | % at age 65 | 2025–2026 | Swisscanto *Pensionskassenstudie* / Finpension | https://www.swisscanto.com/ | 2026-11-22 |
| BVG mandatory minimum interest rate | 1.25 (2024–2026); Federal Council raised to 2.00 for following year (2027); actual pension-fund avg crediting ~4.7% in strong market year | % p.a. | 2025–2027 | Federal Council / BSV / Swisscanto | https://www.bsv.admin.ch/ | 2026-11-22 |
| BWO mortgage reference interest rate (*Referenzzinssatz*) | 1.25 (down from 1.75 peak in late 2023/2024) | % p.a. | 2025–2026 | BWO / FHO | https://www.bwo.admin.ch/bwo/de/home/mietrecht/referenzzinssatz.html | 2026-11-22 |
| Swiss statutory rent adjustment rule | +0.25 pp reference rate → up to +3.0% rent (down −0.25 pp → −2.91%); plus up to **40%** of CPI inflation | tenancy law (VMWG) | Ongoing | BWO / Swiss Tenancy Law | https://www.bwo.admin.ch/bwo/de/home/mietrecht/referenzzinssatz.html | 2026-11-22 |
| Nursing home (*Pflegeheim*) total gross cost | ~10,000–10,900 | CHF/month | 2025–2026 | BFS / Curaviva (Artiset) | https://www.bfs.admin.ch/bfs/de/home/statistiken/gesundheit/gesundheitswesen/alters-pflegeheime.html | 2026-11-22 |
| Resident statutory cap on medical care fee (*Pflegetaxe*) | 23.00 (~713/mo; resident still pays full *Hotellerie & Betreuung* of ~CHF 4,500–6,500/mo unless eligible for *Ergänzungsleistungen*) | CHF/day | 2025–2026 | KVG Art. 25a / Curaviva | https://www.bag.admin.ch/ | 2026-11-22 |
| Median probability/duration of nursing home stay (age 80–90) | no source found (needed before activating an automatic late-life care shock) | % / years | — | — | — | 2026-11-22 |

---

> **Status (2026-11-22, engine):** Part 2 is implemented for children (B), mobility (C), the economy as named deterministic scenarios built from the three regimes (A, not the Markov chain), the 10-year fixed mortgage with its reset, and the opt-in climate scenario (E.4). The figures of Part 1 live in `src/lib/finance/params.ts` with their source and date; the API is in `docs/ENGINE_API.md`. Not implemented: the rent rule tied to the reference rate, SARON mortgages, the heating event as its own type (a heat-pump retrofit is a one-off expense of CHF 43,000), the energy shock, IPV, old-age care, the `car_to_ga` solver lever, the Kotlin port. Where this document says "no source found", the engine asks the user for the value.
>
> **Status (2026-11-22):** implemented in `src/lib/finance/canton.ts` — health-premium real drift (D, 2.5 pp/yr above CPI, canton premium level from the EDI ordinance on average premiums 2026) and cantonal income-tax scaling for the UBS profiles (ESTV-based burden of the cantonal capitals). Used by the dashboard engine, the UBS mapping and `/play`. The built-in accounts keep their payslip-derived tax rates; their premium is a one-person household in their canton.

## Part 2: Engine Design Proposal

### 2.1 Design Principles

1. **Preserve determinism and comparison invariance.** Doppel compares *Real you*, *Disciplined you*, *Plan A*, and *Plan B* on `HEADLINE = { seed: 42, paths: 1000 }` (`scenario.ts`). Currently `monteCarlo.ts:197–200` separates the market stream (`mulberry32(ps)`) from the behavioural coin-flip stream (`mulberry32(ps ^ 0x5bd1e995)`). Every new stochastic draw (macro regimes, child university outcome, heating failure) must live on its own XOR-salted PRNG stream per path so toggling a life event or a behavioural habit never perturbs the market draws:
   - `mrand = mulberry32(ps)` — equities, bonds, home prices, career wage draws (unchanged draw order when macro regimes are off).
   - `brand = mulberry32(ps ^ 0x5bd1e995)` — behavioural panic-selling coin flips (unchanged).
   - `rrand = mulberry32(ps ^ 0x27d4eb2d)` — macro regime Markov transitions (inflation, SARON, mortgage rate, reference rate).
   - `lrand = mulberry32(ps ^ 0x165667b1)` — discrete household life-event draws (child university vs. apprenticeship, boiler failure year, optional late-life care).
2. **Avoid double-counting costs already in `expensesMonth`.** `monthlySpend()` (`investBehavior.ts:52–58`) currently extracts `average` and `rent` from `transactions`. Extend it to also extract `healthInsurance` (category `"insurance"` matching health insurance) and `transport` (public transit / car) so health-premium drift or selling a car adjusts the exact component rather than stacking on top of `expensesMonth`.
3. **Keep `tragbarkeit()` as the single source of truth.** Both the Affordability Card and every Monte Carlo path call `tragbarkeit()` (`swissRules.ts`) at the purchase month using that path's nominal income, equity, and effective stress rate `max(STRESS_RATE, pathMortgageRate)`.
4. **Keep the engine fast (< 350 ms for 1,000 full paths).** Pre-allocate typed `Float64Array` buffers outside the path loop so adding per-path macro arrays does not trigger garbage-collection pauses in the browser or the `solveGoal()` 300-path binary search.

---

### 2.2 Per-Factor Modelling Design

#### A. Economy: 3-State Macro Regime + Mortgage & Rent Transmission

Replace constant `inflation`, `wageGrowth`, `ACTUAL_MORTGAGE_RATE`, and `rentArr = rent * priceIdx` with an optional (default on in Phase 2, toggleable for legacy parity) discrete-time annual Markov chain over three regimes calibrated to Swiss history:

| Regime | Annual CPI (`π`) | Real wage drift (`w_real`) | SNB / SARON (`r_s`) | 10y Fixed Mortgage (`r_f10`) | Annual stay prob. | Empirical anchor |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `low` (Low-rate / deflationary) | `0.2%` | `+0.5%` | `0.0%` (floor; historical −0.75%) | `1.5%` | `0.85` | CH 2015–2021, 2025–2026 |
| `normal` (Price stability) | `1.2%` | `+0.6%` | `1.25%` | `2.4%` | `0.85` | CH 2000–2014 long-run avg |
| `high` (Inflation / rate shock) | `3.8%` | `−0.5%` | `3.5%` | `4.8%` (tail up to 6.5%) | `0.70` | CH 1974 / 1991 / 2022–2023 |

*(All transition-matrix values above are `[design proposal]` starting points; calibrate transition probabilities directly against BFS CPI `je-e-03.04.03.02.01` and SNB historical series before Phase 2 ships.)*

- **Initial state:** `low` (matching 2026 SNB 0.00% / CPI 0.6%).
- **Mortgage cash flow:** Profile/house event specifies `mortgageType: "fixed10" | "saron"` (default `"fixed10"`).
  - `fixed10`: locks `r_f10` at purchase month (or `1.8%` if bought at month 0) and resets every 120 months to the path's prevailing `r_f10`.
  - `saron`: pays `max(0, r_s) + 0.009` (0.90% midpoint of 0.70–1.20% margin), updated quarterly.
  - `tragbarkeit()`: uses `max(STRESS_RATE, currentMortgageRate)` (stays 5.0% in `low` and `normal`; rises only if `currentMortgageRate > 5%`).
- **Rent transmission (BWO Referenzzinssatz):** Track a lagged moving average of mortgage rates rounded to the nearest `0.25%` (`refRate`, starting at `1.25%`). Each time `refRate` steps by `±0.25 pp`, rent adjusts by `+3.0%` / `−2.91%`; in addition, `40%` of annual CPI passes through to rent (per Swiss tenancy law). This replaces the current 100%-CPI rent growth and creates realistic divergence between renters and fixed-rate owners during inflation spikes.
- **Asset & pension linkage:** Cash earns `max(0, r_s − 0.0025)`; BVG credits use `max(1.25%, 0.5 * r_f10)` (reflecting Federal Council floors); real net worth is still deflated by each path's cumulative `priceIdx_path[m]` so all bands stay in today's CHF.

#### B. Children: Multi-Phase Lifecycle, Allowances, Taxes, and Tertiary Track

Extend `LifeEvent` for `type === "child"` with an optional `child?: ChildConfig` payload (omitting it keeps legacy flat-cost behaviour for backward compatibility):

```ts
export interface ChildConfig {
  /** Child's current age in years (0 for future birth; >0 for existing child when event.month === 0). */
  ageYears?: number;
  /** Kita days per week during ages 0–4 (0..5). Default 3. */
  kitaDaysPerWeek?: number;
  /** Daily out-of-pocket Kita tariff (CHF/day); defaults to cantonal/income estimate (CHF 120 unsubsidised). */
  kitaDailyChf?: number;
  /** Post-18 path: "auto" draws per Monte Carlo path using BFS probability; user can pin yes/no. */
  tertiaryTrack?: "auto" | "university" | "apprenticeship";
  /** Lives away from home during university? Default true (higher cost). */
  uniLivesAway?: boolean;
  /** Optional custom probability override when tertiaryTrack === "auto" (default 0.43 from BFS Maturitätsquote). */
  uniProb?: number;
}
```

Monthly net cash-flow phases (all CHF values indexed to `priceIdx`, per child age `a` in years):
1. **Direct baseline cost (excl. rent to avoid double-counting):**
   - Age `0–4`: CHF `850/mo` (first child; `× 0.75` for 2nd+ child, grounded in BFS HABE CHF 819 for 1st / +491 for 2nd, adjusted to 2026 prices).
   - Age `5–12`: CHF `950/mo` (`× 0.80` for 2nd+).
   - Age `13–18`: CHF `1,200/mo` (`× 0.85` for 2nd+).
2. **Kita / daycare (age `0.5` to `4.5`, 48 months):** `kitaDaysPerWeek * 4.2 * kitaDailyChf`. For `ZH` and `GE` (or if user opts into subsidised estimate), apply a simplified income-banded factor (e.g. CHF `25/day` below CHF 60k gross, linear ramp to CHF `120/day` at CHF 130k+ gross, capped at `120` in ZH / `130` private).
3. **Cantonal family allowances (inflow, reduced by marginal tax since Kinderzulagen are taxable income):**
   - Age `0–16`: `FAMILY_ALLOWANCE[canton].child` (e.g. ZH 215, VD 322, BS 275, GE 311) × `(1 − marginalTaxRate)`.
   - Age `16–25` (while in apprenticeship or university): `FAMILY_ALLOWANCE[canton].education` (e.g. ZH 268, VD 425, BS 325, GE 415) × `(1 − marginalTaxRate)`.
4. **Tax savings (annual lump-sum credit in month 11, same pattern as Pillar 3a refund at `monteCarlo.ts:353`):**
   - Child deduction: `(FEDERAL_CHILD_DEDUCTION + cantonalChildDeduction(canton)) * marginalTaxRate_approx + 263` (using conservative effective federal+cantonal share so we never overstate tax savings).
   - Childcare deduction (age < 14): `min(annualKitaPaid, 25_800) * marginalTaxRate`.
5. **Post-18 track (drawn once per path from `lrand` if `tertiaryTrack === "auto"`):**
   - **`university` (default `p = 0.43`, or `0.35` — see Open Decision #1):** age `19–24` (60 months, BSc+MSc). Tuition CHF `1,460/yr` (ETH/cantonal domestic ~CHF 122/mo) + living support CHF `1,500/mo` if living away (CHF 2,282 BFS median minus ~CHF 780 typical part-time student earnings/Stipendium offset `[estimate]`) or CHF `700/mo` if living at home; offset by `Ausbildungszulage`.
   - **`apprenticeship` (complement `1 − p`):** age `16–19` (36–48 months). Direct household cost reduced by 50% of typical `Lehrlingslohn` (CHF 750–1,250/mo) as apprentice covers personal expenses; financially independent at age 20 (`0` cost thereafter).
6. **Optional user-facing output:** Add `childStats?: { uniProb: number; medianLifetimeNetCost: number }` to `SimResult` so the UI can show how much children cost in median vs. university paths.

#### C. Car Ownership vs. Public Transit

Add `EventType: "car"` (plus optional profile `vehicle?: VehicleProfile` for an already-owned/leased car):

```ts
export interface CarConfig {
  mode: "owned" | "leased";
  /** Purchase price (owned) or list price (leased). Default CHF 45,000 (TCS reference) or 25,000 (used). */
  price: number;
  /** Annual km driven. Default 12,000 km (BFS Mikrozensus range 9k–12.8k). */
  annualKm: number;
  /** Owned: replacement interval in years (default 10, BFS fleet age >10.5 yr). Leased: contract term. */
  replaceYears: number;
  /** Current age of car in years at start of simulation (default 0 for new purchase). */
  carAgeYears?: number;
  /** Leased only: monthly lease payment (CHF/mo). */
  leaseMonthly?: number;
  /** Optional resale value share at replacement (default 0.20 after 10 yrs `[estimate]`). */
  resaleShare?: number;
}
```

- **Owned car:** Deducts initial purchase price from cash/portfolio at `event.month` (if `month > 0`); charges monthly non-depreciation fixed costs (insurance + road tax + parking, ~CHF `310/mo`, derived from TCS CHF 6,977/yr fixed minus straight-line depreciation) + variable costs `(annualKm / 12) * 0.276` (TCS CHF 4,135 / 15,000 km = `0.276 CHF/km`, indexed to CPI + optional fuel shock). Every `replaceYears * 12` months, pays `price * (1 − resaleShare) * priceIdx` (stops after age 80 or if sold).
- **Leased car:** Pays `leaseMonthly` + insurance/tax/parking (~CHF `280/mo`) + variable `0.276 CHF/km`, with no purchase lump sum (and no resale asset).
- **Selling a car / switching to public transit:** A `"sell car"` command sets a `carSellMonth` (or removes the `car` event and credits `estimatedResale` as an `income` op), removes monthly car operating costs (or subtracts the car share if baked into `expensesMonth`), and optionally adds a `GA` (`CHF 341/mo`, CHF 4,095/yr from Dec 2026) or `Halbtax` (`CHF 16/mo`, CHF 195/yr) recurring cost.

#### D. Health Insurance Premium Real Drift

- **Baseline extraction:** Add `healthPremiumMonth: number` to `Profile` (derived in `fromHistory()` from `transactions` where `category === "insurance"` and merchant is health insurance: Barlas CHF 318, Meriç CHF 428, Oktay CHF 372; defaults to BAG 2026 age-group mean — CHF 326 for age 19–25, CHF 465 for age 26+ — if not supplied).
- **Drift model:** Split `baseMonthly` into three buckets inside `monteCarlo.ts`:
  1. `rentMonth` (governed by BWO Referenzzinssatz + 40% CPI in Phase 2; CPI in Phase 1).
  2. `healthPremiumMonth` (grows by `CPI + healthExcessGrowth`, default `healthExcessGrowth = 0.025` — slightly conservative vs. the 30-year 1996–2026 BAG excess of ~3.2 pp/yr, so 1.2% CPI + 2.5% = 3.7%/yr nominal; plus child KVG premium CHF 122.50/mo already inside child direct cost or split out explicitly; user can stress-test with a what-if like `"health premiums rise 6% a year"`).
  3. `otherLiving = baseMonthly - rentMonth - healthPremiumMonth` (grows by CPI, multiplied by `0.8` in retirement as today; health premiums do **not** drop by 20% in retirement!).
- **Impact:** Fixing the fact that health premiums do not shrink by 20% at retirement and grow ~2.5 pp/yr faster than CPI makes `RetirementCard`'s "savings last to 90" materially more realistic for young profiles like Barlas, Meriç, and Oktay.
- **IPV (Prämienverbilligung):** Because all 26 cantons set different thresholds, do **not** hardcode 26 IPV formulas in Phase 1. Instead, allow an optional `healthSubsidyMonth` override (default `0`) and display a hint in `Hero` / `RetirementCard` when gross income is below ~CHF 55,000 noting that ~25–28% of residents qualify for cantonal IPV.

#### E. Climate: Fossil Heating Retrofit, Energy Shock, and Optional Portfolio Stress

1. **Heating replacement event (`type: "heating"`):**
   - Applies to homeowners (existing home or planned `house` event with `heatingType: "oil" | "gas"`).
   - Gross cost default: CHF `55,000` (midpoint of CHF 45,000–85,000 heat-pump retrofit range) minus cantonal *Gebäudeprogramm* grant default CHF `12,000` (`[estimate]` within the documented range of several thousand to >25,000) = **CHF 43,000 net one-off** at boiler end-of-life (e.g., 10–15 years after purchase, or user-specified year).
   - Post-retrofit operating-cost effect: eliminates fossil-fuel exposure to CO₂-levy hikes (CHF 120/t; 31.80 Rp/L oil) and switches heating energy to electricity (ElCom 27.70 Rp/kWh median in 2026).
2. **Energy / CO₂ shock scenario knob (`energyShockPct`):**
   - Profile/scenario tracks an optional `heatingFuelMonth` (default CHF 0 for tenants on inclusive *Nebenkosten* unless specified, or CHF 180/mo `[estimate]` for fossil-heated owners) and car fuel share (`~45%` of TCS variable cost).
   - A what-if like `"if heating oil doubles"` sets `energyShockPct = +100%` on fossil heating/fuel components without distorting groceries or rent.
3. **Natural-hazard insurance / deductible drift:**
   - Do not fabricate a single permille building-insurance rate. For homeowners, optionally bump `MAINTENANCE_RATE` from `1.0%` to `1.1%` (`+0.1 pp`, `[estimate]`) under the climate-stress toggle to reflect rising hail/flood insurance and resilience upgrades (citing WSL CHF 300M/yr mean + CH2025 heavier extremes).
4. **Portfolio climate transition stress (`climateStress: "none" | "disorderly"`):**
   - Off (`"none"`) by default to avoid injecting an unverified consensus assumption into the headline number.
   - When set to `"disorderly"` (via scenario toggle or what-if), applies a **−0.4%/yr equity return drag** over the next 10 years (midpoint of the Mercer / Ortec Finance NGFS disorderly range of −0.3% to −0.5%/yr) and discloses the exact NGFS/Mercer source.

#### F. Pensions (AHV/BVG) and Old-Age Care

- **Immediate parameter refresh (`pension.ts`):**
  - Update `BVG_CONVERSION_AT_65` from `0.055` to `0.053` (Swisscanto 2025/2026 effective blended average) — or keep `0.055` and expose it as a profile override since pension funds vary widely.
  - Note in code & UI that the BVG reform was rejected in Sep 2024 (6.8% mandatory minimum unchanged), the 13th AHV pension begins Dec 2026 (already in `AHV_13TH_FACTOR = 13/12`), and the +0.4 pp VAT financing vote takes place 29 Nov 2026 (if passed, adds a one-off ~+0.3% CPI bump to non-exempt spending).
  - Track the 2027 BVG minimum interest rate increase (`1.25%` → `2.0%` announced by Federal Council) in the yearly parameter file.
- **Old-age care tail risk (Phase 4, opt-in toggle `includeCareRisk`):**
  - Because no single official Swiss age-80–90 admission-probability and duration table was verified here, keep off by default until BFS nursing-home stay statistics are compiled. When enabled as a stress test, model a late-life care shock (e.g., age 84–87, net out-of-pocket CHF 5,200/mo = *Hotellerie* + CHF 23/day capped *Pflegetaxe*, floored by *Ergänzungsleistungen* asset thresholds) so users see how care affects `lastsTo90Prob`.

---

### 2.3 Codebase Impact Map

| File / Area | Proposed Changes |
| :--- | :--- |
| `src/lib/finance/params.ts` *(new)* | Central typed registry `SWISS_PARAMS_2026` holding every sourced constant with `{ value, unit, year, source, url }` metadata for both engine calculations and UI disclosures. |
| `src/lib/finance/types.ts` | Add `EventType` members `"car"` and `"heating"`; add optional `child?: ChildConfig`, `car?: CarConfig`, `heating?: HeatingConfig` on `LifeEvent`; add `healthPremiumMonth`, `mortgageType`, `heatingType`, `vehicle` on `Profile`; add `macroRegime`, `healthDriftOverride`, `energyShockPct`, `climateStress` on `Scenario` & `SimInput`; add `childStats` / `macroSummary` on `SimResult`. |
| `src/lib/finance/swissRules.ts` | Add 26-canton `FAMILY_ALLOWANCES` table (BSV 2025/2026), federal + cantonal child/daycare tax-deduction helper, BWO `referenzzinssatzRentFactor()`, `saronRate()`, and allow `tragbarkeit()` to accept an explicit `stressRate = Math.max(STRESS_RATE, currentRate)`. |
| `src/lib/finance/pension.ts` | Read `AHV_MAX_MONTHLY`, `BVG_COORDINATION_DEDUCTION`, `BVG_CONVERSION_AT_65` (`0.053` or configurable), and `BVG_MIN_RATE` from `params.ts`; add optional `vatBumpPct` comment/hook post-Nov 2026 vote. |
| `src/lib/finance/investBehavior.ts` | Extend `monthlySpend()` to return `{ months, average, rent, healthInsurance, transport }` so `fromHistory()` populates `healthPremiumMonth` automatically without double-counting. |
| `src/lib/finance/monteCarlo.ts` | Add XOR-salted PRNG streams `rrand` (macro regimes) and `lrand` (discrete life events); split `expensesMonth` into `rent`, `health`, and `otherLiving`; implement phased `child` cash flows + allowances + tax refunds + stochastic/pinned university draw; implement `car` and `heating` events; move inflation/rate schedule per path using pre-allocated `Float64Array`s when macro regimes are enabled. |
| `src/lib/finance/scenario.ts` | Wire new `Scenario` overrides (`macroRegime`, `healthExcessGrowth`, `energyShockPct`, `climateStress`, `mortgageType`) into `effectiveProfile()` and `simInputFor()`. |
| `src/lib/finance/goalSolver.ts` | Add candidate lever `"car_to_ga"` (when profile/scenario has a car: sell car + buy 2nd-class GA, re-scored on `HEADLINE` seed 42 / 1,000 paths just like `spend`, `invest`, `timing`, `combo`). Keep search ≤ 300 paths so solver latency stays < 1.5 s. |
| `src/lib/twin/actions.ts` | Extend `EVENT_TYPES`, `SET_KEYS`, `Op`, `BOUNDS` (car price CHF 3,000–250,000; lease CHF 150–3,000/mo; heating retrofit CHF 15,000–120,000; mortgage rate 0–10%; inflation 0–10%; health growth 0–12%), `validateOps()`, `applyOps()`, `applyScenarioOps()`, `describeOps()`. In `extractionToUpdate()`, detect car-leasing and Kita bills. |
| `src/app/api/twin/route.ts` | Update `COMMAND_SYS` prompt, `EVENT_TYPES`, and server-side `validatedOps()` bounds to mirror `actions.ts` exactly (Decision 12 dual validation). |
| `src/lib/twin/intents/{en,de,fr,tr,shared}.ts` | Add 0-token regex rules across all 4 locales for university/apprenticeship, car buy/lease/sell/GA, heating retrofit & oil-price shocks, mortgage/inflation/health-premium stresses. |
| `src/lib/i18n/{types,en,de,fr,tr,examples}.ts` | Add new keys for event labels, card breakdowns, solver recipe `"car_to_ga"`, sourced-parameter disclosure strings, and command-bar example chips; keep `npm run i18n:check` passing across all 4 locales. |
| `src/lib/data/profiles.ts` | Populate `healthPremiumMonth` via `fromHistory()` (already in Barlas/Meriç/Oktay transaction histories); add `mortgageType: "fixed10"` on Meriç's planned Renens flat. |
| `src/lib/accounts/types.ts` & `store.ts` | Extend `ProfileFields` and `NewAccountInput` with optional `children`, `vehicle`, `healthPremiumMonth`, `heatingType` (all optional with safe defaults for existing stored accounts). |
| `src/components/Hero.tsx`, `Cards.tsx`, `RetirementCard.tsx`, `DoppelApp.tsx` | Add `EVENT_ICON` entries (`car: "🚗"`, `heating: "🔥"` or `"♻️"`); show child phase / university pill on `Timeline`; show mortgage type & reset risk in `AffordabilityCard`; show health-premium real growth in `RetirementCard`; expand `<Disclosure summary={t("common.howCalculated")}>` in `Hero.tsx` to render the active sourced parameters from `params.ts`. |

---

### 2.4 New 0-Token What-If Sentences

Every sentence below should parse locally at **0 tokens** across `en.ts`, `de.ts`, `fr.ts`, and `tr.ts` (falling back to `/api/twin` only for unusual phrasing):

| User intent | EN example | DE / FR / TR examples | Mapped `Op`(s) |
| :--- | :--- | :--- | :--- |
| Pin child to university | "What if my kid studies at ETH?" | "Was wenn mein Kind an der ETH studiert?" / "Et si mon enfant étudie à l'EPFL ?" / "Çocuğum ETH'da okursa?" | `set` / update existing `child` event `tertiaryTrack: "university"` (or add `child` if none exists) |
| Pin child to apprenticeship | "What if my child does an apprenticeship?" | "Wenn mein Kind eine Lehre macht" / "Si mon enfant fait un apprentissage" / "Çocuğum çıraklık yaparsa" | Update `child` event `tertiaryTrack: "apprenticeship"` |
| Buy a car | "Buy a car for 35k in 2028" | "2028 ein Auto für 35k kaufen" / "Acheter une voiture à 35k en 2028" / "2028'de 35 bine araba alsam" | `add` `type: "car"`, `mode: "owned"`, `price: 35000`, `month` |
| Lease a car | "Lease a car for 500 a month" | "Auto leasen für 500 pro Monat" / "Leasing voiture 500 par mois" / "Ayda 500'e araba kiralasam" | `add` `type: "car"`, `mode: "leased"`, `leaseMonthly: 500` |
| Sell car / switch to GA | "If I sell the car" / "Sell car and get a GA" | "Auto verkaufen und GA kaufen" / "Vendre la voiture pour un AG" / "Arabayı satıp GA alsam" | `remove` `car` + `income` resale + optional `recurring` GA (CHF 341/mo) |
| Heating oil shock | "If heating oil doubles" | "Wenn sich der Heizölpreis verdoppelt" / "Si le mazout double" / "Kalorifer yakıtı iki katına çıkarsa" | `set` `energyShockPct: 100` |
| Heat pump retrofit | "Replace oil heating with a heat pump in 2029" | "Ölheizung 2029 durch Wärmepumpe ersetzen" / "Remplacer le mazout par une PAC en 2029" / "2029'da ısı pompasına geçsem" | `add` `type: "heating"`, `month`, net CHF 43,000 |
| Interest / mortgage shock | "What if mortgage rates hit 4%?" / "Switch to SARON" | "Wenn Hypothekarzinsen auf 4% steigen" / "Passer au SARON" / "Konut kredisi faizi %4 olursa" | `set` `macroRegime: "high"` or `mortgageType: "saron"` |
| Inflation / health stress | "Health premiums rise 6% a year" / "Inflation stays at 3%" | "Krankenkassenprämien steigen 6% pro Jahr" / "Primes maladie +6% par an" / "Sağlık primi yılda %6 artsa" | `set` `healthDriftOverride: 0.06` / `macroRegime: "high"` |

---

### 2.5 Onboarding Wizard Integration

Another agent is building the onboarding wizard in parallel on top of `NewAccountInput` and `ProfileFields` (`src/lib/accounts/types.ts`). To avoid bloated forms while capturing the parameters that move net worth most:

1. **Keep the wizard to 3–4 short steps; make real-world extras progressive (optional toggles with smart defaults):**
   - **Children step (collapsible "Do you have or plan children?"):**
     - If *Yes*: ask **number of children** (1–4) and each child's **current age** (or expected birth year).
     - Only show **Kita days/week** (0–5, default 3) for children under age 5.
     - Do **not** ask for university tuition or allowances during onboarding — default `tertiaryTrack` to `"auto"` (BFS probability) and auto-apply the profile's canton `FAMILY_ALLOWANCES`, editable later on the Timeline card.
   - **Mobility step (single 3-option segmented control):**
     - `Public transit / none` (default — no extra fields) | `Own a car` (asks optional car age + annual km, defaulting to 5 yr / 12,000 km & TCS 2026 cost) | `Lease a car` (asks monthly lease CHF, defaulting to CHF 450/mo).
   - **Health insurance:** Auto-populated from imported/entered expenses if present; otherwise pre-filled with the BAG 2026 age-band mean (CHF 326 for 19–25, CHF 465 for 26+) as a single editable CHF/month field so we never double-count.
   - **Home heating:** Only shown if the user indicates they already own a home (`Oil / Gas` vs. `Heat pump / District / Unsure`).
2. **Schema compatibility:** All new fields on `NewAccountInput` and `ProfileFields` must be optional (`children?: ...`, `vehicle?: ...`, `healthPremiumMonth?: number`, `heatingType?: ...`) so accounts created by the current wizard or stored in `localStorage` deserialize cleanly without migration breakage.

---

### 2.6 Explainability and Source Disclosure in the UI

Doppel already uses `<Disclosure summary={t("common.howCalculated")}>` in `src/components/Hero.tsx:78–91` and `src/components/Cards.tsx:290–294`, plus `<Disclosure summary={t("common.details")}>` in `AffordabilityCard` (`Cards.tsx:134`) and `RetirementCard` (`RetirementCard.tsx:66`).

To ensure every new number is inspectable and attributable:
- **Central parameter table (`params.ts` → Hero disclosure):** Render a compact "Assumptions & Swiss sources" list inside `Hero.tsx`'s existing *"How is this calculated?"* disclosure showing only the parameters active for the user's current scenario (e.g., if the user has no car, hide TCS km costs; if they have a child in VD, show `VD Kinderzulage CHF 322/mo (BSV 2026)` and `University probability 43% (BFS 2024)` with clickable source links).
- **Per-card attribution:**
  - `AffordabilityCard`: show `mortgageType` (`10-yr fixed` vs. `SARON`), starting rate vs. `5.0%` SBA/FINMA stress rate, and refinancing-year note.
  - `RetirementCard`: show health-insurance premium projected in today's CHF at age 65 vs. today (e.g., `CHF 428 → CHF 870/mo real at 65, BAG 1996–2026 trend`).
  - `Timeline` child chip: expand on click to show phase breakdown (Kita, school, teen, university/apprenticeship toggle, cantonal allowance offset).
- **Explicit uncertainty labels:** Tag non-statutory estimates (heat-pump cost range, student parental-support share, NGFS equity drag) visually as `Estimate` / `Scenario` so users distinguish legal rules (BSV allowances, DBG deductions, BWO rent formula) from assumptions.

---

### 2.7 Impact on the Kotlin Multiplatform Port (`pocket/`)

`pocket/shared/src/jvmTest/kotlin/ch/doppel/pocket/finance/EngineParityTest.kt` checks every number in `SimResult`, `AffordabilityResult`, `BehaviorParams`, `HabitCosts`, `WaitingCost`, and `Recipe` against `pocket/shared/src/jvmTest/resources/engine-golden.json` (generated by `scripts/pocket-engine-golden.ts`), enforcing **exact `0.0` tolerance on integers and `*Prob` fields and `1e-7` on all `Double` values**.

Every phase merged into `src/lib/finance/` must port the following to `pocket/`:

1. **Finance models & engine:**
   - `pocket/shared/src/commonMain/kotlin/ch/doppel/pocket/finance/Models.kt` — new `EventType` values (`CAR`, `HEATING`), `ChildConfig`, `CarConfig`, `HeatingConfig`, `Profile` & `Scenario` & `SimInput` fields, `SimResult` extensions.
   - `pocket/shared/src/commonMain/kotlin/ch/doppel/pocket/finance/SwissParams.kt` *(new)* — exact numeric constants mirroring `src/lib/finance/params.ts`.
   - `pocket/shared/src/commonMain/kotlin/ch/doppel/pocket/finance/SwissRules.kt` — 26-canton `FAMILY_ALLOWANCES`, child tax deduction, BWO rent adjustment, `tragbarkeit()` stress-rate floor.
   - `pocket/shared/src/commonMain/kotlin/ch/doppel/pocket/finance/Pension.kt` — updated BVG conversion / minimum rate constants.
   - `pocket/shared/src/commonMain/kotlin/ch/doppel/pocket/finance/MonteCarlo.kt` — identical XOR-salted `mulberry32` streams (`rrand`, `lrand`) and **exact draw order** (any extra `randn()` or `lrand()` call out of sequence breaks `0.0` probability parity).
   - `pocket/shared/src/commonMain/kotlin/ch/doppel/pocket/finance/Behavior.kt`, `Scenario.kt`, `GoalSolver.kt`, `Profiles.kt` — `healthPremiumMonth` derivation, scenario plumbing, `"car_to_ga"` solver lever.
2. **Local 0-token intent parsers & commands:**
   - `pocket/shared/src/commonMain/kotlin/ch/doppel/pocket/twin/Commands.kt` + `{English,German,French,Turkish}Intents.kt` + `IntentPatterns.kt` + `LocalInputTest.kt`.
3. **Golden parity suite:**
   - Extend `scripts/pocket-engine-golden.ts` and `EngineParityTest.kt` with new fixture scenarios (`child_uni`, `car_vs_ga`, `macro_high_rates`, `heating_retrofit`) and regenerate `engine-golden.json` at the end of every phase.
4. **PRNG portability guard:** Use only IEEE-754 `Double`, `Math.pow` / `Double.pow`, `Math.exp` / `exp`, and 32-bit unsigned integer ops (`imul` / `Int.times`) in `mulberry32` — avoid platform-specific `Math.expm1` or locale-dependent rounding inside the simulation loop.

---

### 2.8 Phased Rollout Plan

Ordered by **realism gained per unit of engineering complexity**:

| Phase | Scope | Why this order | Est. effort (TS + UI + i18n + Kotlin) |
| :--- | :--- | :--- | :--- |
| **Phase 1: Household Cash-Flow Reality** | 1. Central `params.ts` + Hero sourced-parameter disclosure.<br>2. Health-premium real excess drift (`+2.5 pp/yr` above CPI, no −20% retirement cut, auto-extracted `healthPremiumMonth`).<br>3. Phased `child` event (age bands, Kita, 26-canton BSV allowances, federal/cantonal tax deductions, `auto`/`university`/`apprenticeship` track on `lrand`).<br>4. `car` event (TCS 2026 owned/leased costs, replacement cycle, sell-car / GA switch + `car_to_ga` solver lever).<br>5. 4-locale intents + Kotlin parity + golden tests. | Highest household CHF impact (health drift + CHF 585/mo car-vs-GA gap + CHF 100k+ child/uni variance) with **zero** change to the market/macro stochastic core; `priceIdx` stays path-independent so runtime stays ~0.2 s. | **6–8 eng-days** (TS engine & params 2.5d, 4-locale intents & `/api/twin` 1.5d, UI & i18n 1.5d, Kotlin port & golden tests 2d) |
| **Phase 2: Macro & Housing Regimes** | 1. 3-state Markov macro regime (`low` / `normal` / `high` calibrated on BFS CPI & SNB history) on `rrand`.<br>2. `fixed10` vs. `saron` mortgage paths + refinancing resets + `tragbarkeit()` dynamic rate floor.<br>3. BWO `Referenzzinssatz` + 40% CPI rent indexation.<br>4. BVG conversion rate (`5.3%`) & 2027 minimum-rate refresh + AHV VAT outcome update (after 29 Nov 2026 vote).<br>5. 4-locale rate/inflation what-ifs + Kotlin parity. | Directly addresses Switzerland's economic development, interest-rate risk, and rent vs. buy realism. Requires moving `priceIdx`/`baseExp` inside the path loop — do after Phase 1 so performance can be benchmarked cleanly. | **5–7 eng-days** (macro engine & calibration 2.5d, UI/AffordabilityCard updates 1d, intents/i18n 1d, Kotlin port & parity 2d) |
| **Phase 3: Climate & Energy Transition** | 1. `heating` retrofit event (MuKEn oil/gas → heat pump CHF 45–85k gross minus *Gebäudeprogramm* grant).<br>2. Fossil heating & car-fuel `energyShockPct` what-if ("if heating oil doubles").<br>3. Opt-in `climateStress: "disorderly"` toggle (NGFS/Mercer −0.4%/yr 10-yr equity drag + `+0.1 pp` owner maintenance/insurance resilience buffer).<br>4. 4-locale climate/energy intents + Kotlin parity. | Captures the concrete household climate cash shock (heating replacement & fuel spikes) without polluting base equity returns with disputed macro-climate point estimates. | **3–4 eng-days** (TS engine 1d, UI & disclosures 1d, intents/i18n 0.5d, Kotlin port & parity 1d) |
| **Phase 4: Old-Age Care & Regional Polish** | 1. Source BFS nursing-home admission probability/duration and add opt-in `includeCareRisk` toggle to `RetirementCard`.<br>2. Canton-specific Kita subsidy calculator (ZH *Beitragsfaktor*, GE *Barèmes A/B*, VD, BS) + optional IPV hint/override.<br>3. Onboarding wizard progressive steps for children, car, and heating. | High value for older cohorts and parents in ZH/GE, but requires sourcing additional cantonal tables and coordinating with the onboarding wizard branch. | **4–6 eng-days** (research/tables 1.5d, engine + wizard UI 2.5d, Kotlin port 1.5d) |

**Total estimated effort across all 4 phases:** ~18–25 engineering days. Phase 1 alone delivers the majority of user-visible realism in ~1.5 weeks.

---

### 2.9 Risks and Mitigations

1. **False precision and illusion of certainty:** Showing a headline probability like `71.4%` after stacking 15 new parameters can mislead users into thinking 30-year Kita tariffs, university living costs, or heat-pump grants are known to the franc.
   - *Mitigation:* Label non-statutory numbers clearly as estimates, keep speculative macro-climate equity drags opt-in, and emphasize the P10–P90 cone spread alongside the headline number.
2. **Annual parameter drift / staleness:** BAG health premiums change every autumn, BWO `Referenzzinssatz` and SNB rates update quarterly, ElCom electricity prices and TCS km-costs update yearly, and AHV/BVG/3a ceilings update every 2 years (plus the 29 Nov 2026 AHV VAT referendum).
   - *Mitigation:* Isolate all Swiss figures in one versioned file (`src/lib/finance/params.ts` mirrored in `SwissParams.kt`) stamped with `AS_OF_YEAR = 2026` and a documented annual refresh checklist (every November after BAG/ElCom/BSV announcements).
3. **Double-counting household expenses:** Built-in profiles (and real users' bank histories) already include health insurance, rent, and transit inside `expensesMonth`. Adding car costs or health drift without carving out the baseline component would inflate spending.
   - *Mitigation:* Carve out `rentMonth`, `healthPremiumMonth`, and `transportMonth` in `monthlySpend()` (`investBehavior.ts`) and assert `rent + health + otherLiving === baseMonthly` in `scripts/engine-check.ts`.
4. **Performance degradation in browser and solver:** Moving `priceIdx`, `baseExp`, and `rentArr` inside the `for (let path = 0; path < paths; path++)` loop in Phase 2 multiplies monthly schedule work by `1,000×` (and `solveGoal()` runs `~15–25` simulations).
   - *Mitigation:* Avoid object allocations inside the inner loop (use scalars or pre-allocated `Float64Array`s), keep `horizon: "goal"` truncation intact, and gate Phase 2 on `scripts/engine-check.ts` staying under `500 ms` per 1,000-path run (or moving `solveGoal()` to a Web Worker as already noted in `docs/DECISIONS.md` Q10).
5. **TS ↔ Kotlin golden parity breakage:** Any divergence in PRNG draw order or floating-point rounding breaks `EngineParityTest.kt` (`0.0` tolerance on probabilities).
   - *Mitigation:* Dedicated XOR-salted streams (`rrand`, `lrand`) and mandatory `scripts/pocket-engine-golden.ts` + `./gradlew :shared:jvmTest` check at the end of every phase.
6. **Cantonal complexity creep:** Switzerland has 26 cantonal tax systems, 26 IPV subsidy formulas, 26 MuKEn adoption schedules, and municipal Kita fee tables.
   - *Mitigation:* Implement exact 26-canton tables only where official federal compilations exist (BSV `FAMILY_ALLOWANCES`, SBA/cantonal `CLOSING_RATE`); for highly municipal rules (Kita subsidies, IPV, VD/GE tax quotients), provide clean defaults plus a direct CHF override field.
