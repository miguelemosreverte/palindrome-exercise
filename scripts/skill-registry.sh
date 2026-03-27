#!/bin/bash
# Skill Registry — reusable prompt primitives for the task runner
#
# Source this file to get skill functions and pipeline composers:
#   source scripts/skill-registry.sh
#   skill_web_search "Scala developers LATAM"
#   compose_research_pipeline "Scala developers LATAM"

# --- Individual Skills ---

skill_web_search() {
  echo "Use Playwright browser to go to google.com and search for \"$1\". Read the first 5 results. Format as: Source, Title, URL, Summary (one line each)."
}

skill_browse_site() {
  echo "Use Playwright browser to navigate to $1. Read the page content. Extract: $2"
}

skill_save_csv() {
  local data="$1"
  local headers="$2"
  printf 'Take this data:\n%s\n\nFormat as CSV with headers: %s. Output ONLY the CSV text, no markdown.' "$data" "$headers"
}

skill_generate_chart() {
  local data="$1"
  local chart_type="$2"
  printf 'Given this CSV data:\n%s\n\nGenerate a ```chartjs %s chart. Output ONLY the chartjs block.' "$data" "$chart_type"
}

skill_summarize() {
  local data="$1"
  printf 'Summarize this data concisely:\n%s\n\nFormat as a ```cards block with 4 key metrics.' "$data"
}

skill_extract_contacts() {
  echo "From this data, extract contact information (name, email, LinkedIn, location) where available. Format as JSON array."
}

skill_compare() {
  local data="$1"
  local criteria="$2"
  printf 'Compare these items:\n%s\n\nCriteria: %s\nFormat as a ```table block with a score column.' "$data" "$criteria"
}

# --- Pipeline Composers ---
# These output JSON step arrays for the task runner

compose_research_pipeline() {
  local query="$1"
  cat <<PIPELINE
[
  {"name":"search","prompt":"$(skill_web_search "$query")","status":"pending","result":null},
  {"name":"collect","prompt":"From the search results in {{results.search}}, extract structured data: Name, Location, Skills, Source URL. Format as a clean list.","status":"pending","result":null},
  {"name":"csv","prompt":"$(skill_save_csv '{{results.collect}}' 'Name,Location,Skills,Source')","status":"pending","result":null},
  {"name":"chart","prompt":"$(skill_generate_chart '{{results.csv}}' 'bar')","status":"pending","result":null},
  {"name":"summary","prompt":"$(skill_summarize '{{results.csv}}')","status":"pending","result":null}
]
PIPELINE
}

compose_competitive_analysis() {
  local company="$1"
  cat <<PIPELINE
[
  {"name":"search","prompt":"$(skill_web_search "$company competitors market analysis 2026")","status":"pending","result":null},
  {"name":"details","prompt":"$(skill_browse_site '{{results.search}}' "company details, revenue, market share, key products")","status":"pending","result":null},
  {"name":"compare","prompt":"$(skill_compare '{{results.details}}' 'market share, growth, product range')","status":"pending","result":null},
  {"name":"summary","prompt":"$(skill_summarize '{{results.compare}}')","status":"pending","result":null}
]
PIPELINE
}

compose_hr_search() {
  local role="$1"
  local region="$2"
  cat <<PIPELINE
[
  {"name":"search","prompt":"$(skill_web_search "$role developers in $region LinkedIn GitHub")","status":"pending","result":null},
  {"name":"collect","prompt":"From the search results in {{results.search}}, extract candidate names, locations, skills, and profile URLs. Format as a structured list.","status":"pending","result":null},
  {"name":"enrich","prompt":"For each candidate in {{results.collect}}, search for more details about their experience and projects. Add years of experience and notable projects.","status":"pending","result":null},
  {"name":"csv","prompt":"$(skill_save_csv '{{results.enrich}}' 'Name,Location,Skills,Experience,Projects,Source')","status":"pending","result":null},
  {"name":"chart","prompt":"$(skill_generate_chart '{{results.csv}}' 'bar')","status":"pending","result":null}
]
PIPELINE
}

# If called directly, show available skills
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "Available skills:"
  echo "  skill_web_search <query>"
  echo "  skill_browse_site <url> <extract>"
  echo "  skill_save_csv <data> <headers>"
  echo "  skill_generate_chart <data> <type>"
  echo "  skill_summarize <data>"
  echo "  skill_extract_contacts"
  echo "  skill_compare <data> <criteria>"
  echo ""
  echo "Pipelines:"
  echo "  compose_research_pipeline <query>"
  echo "  compose_competitive_analysis <company>"
  echo "  compose_hr_search <role> <region>"
fi
