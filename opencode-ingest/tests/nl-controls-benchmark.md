# NL→Controls Benchmark Report

## Task

Translate natural language queries into exact UI filter control states.
"senior backend java devs in córdoba" → `{domain:"engineering", city:"Córdoba", skills:["Java"]}`

## Results

| Model | Provider | Accuracy | Avg Latency | Cost | Notes |
|---|---|---|---|---|---|
| **mistral-nemo** | ChutesAI | **10/10** | **862ms** | $0.02/$0.04 | **Best: fast + accurate** |
| gemma-4b | ChutesAI | 9/10 | 1,586ms | $0.01/$0.03 | Cheapest, one soft fail |
| oc-bigpickle | OpenCode | **10/10** | 26,000ms | **Free** | Perfect but slow |
| oc-nemotron | OpenCode | **10/10** | 19,000ms | **Free** | Perfect but slow |

## Recommendation

- **Production (paid)**: `mistral-nemo` — 10/10 accuracy, sub-second, cheap
- **Development (free)**: `oc-nemotron` — 10/10 accuracy, 19s, free via OpenCode

## Test Queries (all models scored on these)

| # | Query | Expected Controls |
|---|---|---|
| 1 | "senior backend java developers in córdoba" | domain=engineering, city=Córdoba, seniority=senior, skills=[Java] |
| 2 | "HR people who do recruiting" | domain=hr, skill_subcategories=[Recruiting] |
| 3 | "find me data scientists" | domain=data, skill_categories=[Data] |
| 4 | "managers in buenos aires" | domain=management, city=Buenos Aires |
| 5 | "devops engineers with docker experience" | domain=engineering, skill_categories=[DevOps], skills=[Docker] |
| 6 | "senior engineers who know python or go" | domain=engineering, seniority=senior, skills=[Python, Go] |
| 7 | "people in consulting" | domain=consulting |
| 8 | "frontend developers" | domain=engineering, skill_subcategories=[Frontend] |
| 9 | "everyone with machine learning skills" | skill_categories=[Data] |
| 10 | "show architects and leads" | skill_subcategories=[Architecture, Leadership] |

## Architecture

```
User speaks: "find senior java devs in córdoba"
  ↓
Load available controls from SQLite (enums + skill tree)
  ↓
Build compact prompt (~300 tokens): filters + query
  ↓
LLM (862ms avg): returns JSON control state
  ↓
Validate & auto-fix: case correction, invalid skill removal
  ↓
Apply to UI: set dropdowns, activate skill tags, update table
```

## Why This Works

1. **Tiny search space**: 7 enums + 150 tags (vs infinite SQL)
2. **Deterministic validation**: does this value exist? yes/no, auto-fix if close
3. **Sub-second on paid models**: 862ms with Mistral Nemo
4. **Perfect on free models**: OpenCode's nemotron/bigpickle hit 10/10
5. **Enables voice**: microphone → text → controls → instant filter
6. **Prompt is ~300 tokens**: cheap, fast, fits any model

## CLI

```bash
# Single query
node bin/nl-to-controls.js ar-senior-devs-linkedin "senior java devs in córdoba"
node bin/nl-to-controls.js ar-senior-devs-linkedin "HR recruiters" --model=oc-nemotron

# Benchmark all models
node bin/nl-to-controls.js ar-senior-devs-linkedin --benchmark

# Models: gemma-4b, mistral-nemo, oc-bigpickle, oc-nemotron, oc-gpt5nano
```
