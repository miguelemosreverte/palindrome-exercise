# LinkedIn Vendor — Two-Pass LLM Labeling Pipeline

## Architecture

```
Profile HTML → parse.js → raw record → label.js → labeled record → report
                                          │
                                    ┌─────┴─────┐
                                 Pass 1       Pass 2
                                (Extract)   (Normalize)
                                    │           │
                              raw labels    pipe-delimited
                              + confidence  taxonomy paths
```

## The Problem

LinkedIn profile data is messy:
- Skills contain UI text ("Mostrar todo", "Validar"), names ("María Laura Marquez"), and spam
- Titles are inconsistent ("Sr" vs "Senior", "fullstack" vs "Full Stack")
- The same skill appears in different forms ("REST APIs" vs "RESTful APIs")
- Seniority is vague — "Senior" covers 83% of profiles
- HR recruiters get classified as DevOps because they mention "automation"

## The Solution: Two-Pass Pipeline

### Pass 1 — Extract (raw labels)

The LLM reads the profile and outputs every skill it finds:
- **Explicit** (confidence 1.0): directly in title/headline/skills
- **Inferred** (confidence 0.5-0.95): likely given the role

A Java Backend Engineer gets: Java (explicit), Spring Boot (explicit), Docker (inferred 0.85), REST APIs (inferred 0.9), SQL (inferred 0.8)

The LLM disambiguates by domain: "Automation" for HR → "HR Process Automation", not "CI/CD Automation"

Output: `raw_labels` column (JSON) — inspectable, debuggable

### Pass 2 — Normalize (taxonomy mapping)

A **fixed taxonomy skeleton** defines the hierarchy:
```
Engineering|Backend (Java, Spring Boot, REST APIs, Microservices)
Engineering|Frontend (JavaScript, React, Nuxt.js)
Engineering|Databases (SQL, NoSQL, Elasticsearch)
DevOps|Containers (Docker, Kubernetes, OpenShift)
DevOps|Cloud (AWS, GCP, Terraform)
HR|Recruiting (Talent Acquisition, Sourcing, Interviewing)
Management|Leadership (Team Leadership, Mentoring, Coaching)
...27 categories
```

The LLM maps each raw label to a pipe-delimited path. It follows the skeleton's structure but **can invent new leaves**. In practice, 27 fixed categories produce ~150 unique paths — 59% are LLM-original.

Examples of LLM-original paths:
- `Engineering|Backend|Payment Systems` — Fintech engineer
- `HR|Tools|Recruitment Process Outsourcing (RPO)` — Headhunter
- `Management|Operations|Employee Wellness` — Coach
- `Engineering|Architecture|Cloud Engineering` — DevOps architect

### Post-processing

After the LLM, a cleanup step fixes common mistakes:
- Spelling: "Problem-Solving" → "Problem Solving"
- Stuttering: "Management|Leadership|Leadership" → "Management|Leadership"
- Misplacements: "Languages|Programming|Spanish" → "Languages|Spoken|Spanish"
- Orphans: bare "Mentoring" → "Management|Leadership|Mentoring"
- Domains: "other" → inferred from context
- Cities: "Cordoba" → "Córdoba"

## Why Pipe-Delimited?

`Engineering|Backend|Java` supports:
- Unlimited depth without JSON nesting
- SQL queries: `LIKE 'Engineering|%'` matches all engineering skills
- Tree rendering: split on `|`, build hierarchy
- Human-readable in the database

## UI: Faceted Filter + Skill Tree

The report renders the taxonomy as a clickable skill tree:
- **Dark pills**: top-level categories (Engineering, DevOps, HR, Management)
- **Click parent**: filters table + expands children
- **Blue sub-pills**: mid-level (Backend, Containers, Recruiting)
- **Light pills**: leaf skills (Java, Docker, Talent Acquisition)
- **Collapse clears**: collapsing a branch removes all its active filters
- **Discriminator logic**: hides siblings with identical people sets

## Model Catalog

Easily swap between providers:

| Key | Provider | Model | Cost |
|-----|----------|-------|------|
| mistral-nemo | ChutesAI | Mistral Nemo 12B | $0.02/$0.04 |
| gemma-4b | ChutesAI | Gemma 3 4B | $0.01/$0.03 |
| hermes-14b | ChutesAI | Hermes 4 14B | $0.01/$0.05 |
| qwen-32b | ChutesAI | Qwen 3 32B | $0.08/$0.24 |

## CLI

```bash
node bin/label.js <task>                    # label all unlabeled
node bin/label.js <task> --limit=10         # iterate on 10
node bin/label.js <task> --reset            # clear all labels
node bin/label.js <task> --model=qwen-32b   # use better model
node bin/label.js --list-models             # show catalog
```

## Files

```
vendors/linkedin/
├── fetch.js    ← Playwright + human emulation, saves HTML per profile
├── parse.js    ← HTML → raw records (name, title, company, photo...)
├── clean.js    ← Record normalization (junk names, UI noise)
├── label.js    ← Two-pass LLM labeling (extract → normalize)
└── README.md   ← This file
```
