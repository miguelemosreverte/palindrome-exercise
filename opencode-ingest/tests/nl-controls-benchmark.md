# NL→Controls Benchmark Report

## Task

Translate natural language queries into exact UI filter control states.
Not SQL — just enum values, tag selections, and slider positions.

## Models Tested

| Model | Provider | Cost (per 1M tokens) | Accuracy | Avg Latency | Avg Tokens |
|---|---|---|---|---|---|
| **gemma-3-4b-it** | ChutesAI | $0.01 in / $0.03 out | **9/10 (90%)** | 1,717ms | 1,131 |
| Mistral-Nemo-12B | ChutesAI | $0.02 in / $0.04 out | 7/10 (70%) | 1,123ms | 1,288 |
| Hermes-4-14B | ChutesAI | $0.01 in / $0.05 out | 0/10 (0%) | — | — |

## Winner: gemma-3-4b-it

- **Cheapest** ($0.01/$0.03)
- **Most accurate** (90%)
- **Acceptable latency** (1.7s)
- Only failure: "Recruiting" as a leaf (it's a subcategory)

## Test Queries & Results (gemma-4b)

| Query | Result | Valid |
|---|---|---|
| "senior backend java developers in córdoba" | domain=engineering, city=Córdoba, seniority=senior, skills=[Java] | ✓ |
| "HR people who do recruiting" | domain=hr, skills=[Recruiting] | ✗ (Recruiting is subcategory) |
| "find me data scientists" | domain=data, skills=[Data Science] | ✓ |
| "managers in buenos aires" | domain=management, city=Buenos Aires, seniority=director | ✓ |
| "devops engineers with docker" | domain=engineering, skill_categories=[DevOps], skills=[Docker] | ✓ |
| "senior engineers who know python or go" | domain=engineering, seniority=senior, skills=[Python, Go] | ✓ |
| "people in consulting" | domain=consulting | ✓ |
| "frontend developers" | domain=engineering, subcategories=[Frontend], skills=[JavaScript, React, Vue.js] | ✓ |
| "everyone with machine learning skills" | skill_categories=[Data], skills=[AI, Machine Learning] | ✓ |
| "show architects and leads" | domain=engineering, seniority=senior | ✓ |

## Mistral-Nemo Failures

| Query | Issue |
|---|---|
| "HR people who do recruiting" | Put "Recruiting" as leaf skill (it's a subcategory) |
| "frontend developers" | Put "Frontend" as top-level skill_category (it's under Engineering) |
| "show architects and leads" | Put "Leadership" as skill_category (it's under Management) |

## Hermes-14B: Total Failure

All 10 queries returned non-JSON responses. The model doesn't respect `response_format: json_object` reliably.

## Architecture

```
User: "senior java devs in córdoba"
  ↓
Prompt: available controls (enums + skill tree) + user query
  ↓
LLM (gemma-4b, 1.7s, ~1K tokens)
  ↓
{domain: "engineering", city: "Córdoba", seniority_level: "senior", skills: ["Java"]}
  ↓
Validate: all values exist in controls ✓
  ↓
Apply to UI: set dropdowns, activate skill tags, update table
```

## Why This Works Better Than NL→SQL

1. **Tiny search space**: 7 enums + 150 tags vs infinite SQL
2. **Deterministic output**: exact values, no syntax errors
3. **Instant validation**: does this value exist? yes/no
4. **Faster**: 1.7s vs 20-50s for SQL generation
5. **Cheaper**: ~1K tokens vs ~5K tokens
6. **Enables voice**: microphone → text → controls → instant filter
