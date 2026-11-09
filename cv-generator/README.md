# CV Generator: tailor your CV to each job, using only true facts

Give it a job link. It reads the posting, works out what the company wants, and produces a
tailored CV (Word + PDF) in your own template, using **only** facts from your personal database.

```
job URL ──► fetch & clean posting ──► Claude: analyse job + select/order/reword your facts (by id)
                                              │
your profile.yaml (facts database) ───────────┤
                                              ▼
                                  Truth guard (deterministic checks)
                                              ▼
                     your Word template (.docx) ──► CV.docx ──► CV.pdf  + match_report.md
```

## CV Studio: the web app (recommended)

Run it on your computer:

| | |
|---|---|
| **Windows** | double-click `start.bat` |
| **macOS / Linux** | run `./start.sh` |
| manually | `pip install -r requirements.txt` then `python -m cvgen web` |

It opens at <http://127.0.0.1:8765>. You need Python 3.10+. For PDF export and previews,
install [LibreOffice](https://www.libreoffice.org) (free). Without it you still get Word files.

1. **Settings**: paste your Anthropic API key (from console.anthropic.com).
2. **Knowledge**: upload everything about you: your current CV, your LinkedIn profile
   (*More → Save to PDF*, or the *Get a copy of your data* ZIP), your XING profile PDF,
   references, certificates, project notes, or your website's URL. Click **Build knowledge
   base**. Claude extracts the facts and shows a review: every added or changed item,
   conflicts between sources (e.g. different dates on LinkedIn and in the CV), numbers it could
   not find in any source, and questions that would strengthen your profile. Nothing is saved
   until you click *Save*. You can edit everything afterwards in the built-in editor.
3. **Templates**: upload your current CV as `.docx`. Claude maps your layout to placeholders and
   keeps your fonts, colours, photo and columns. A preview is rendered with your data.
4. **New application**: paste a job link or the job text and click **Generate**. You get the
   tailored CV (preview, PDF, Word), the requirements you meet and miss, talking points for the
   cover letter, and a list of what the fact check corrected. *Change design* re-renders the
   same content in another template without a new AI call.

All your data stays in the `workspace/` folder on your computer (git-ignored). Only the
documents you process are sent to the Anthropic API.

## How it keeps you honest

The AI never writes facts. It only returns a *plan* that references items in your profile by id:

| What | Where it comes from |
|---|---|
| Name, contact, employers, job titles, dates, degrees, certifications, languages | Copied from `profile.yaml`. The AI can only choose which ones to show. |
| Headline | Must be one of your `headlines`, word for word |
| Skills | Only skill ids from your profile. The AI chooses and orders them. |
| Bullet points | Your own bullets, chosen and ordered by relevance, optionally reworded to match the job ad's wording |
| Profile summary | Written from your facts and then checked; if a check fails, your own summary is used instead |

Every reworded bullet and the summary go through the **truth guard** (`cvgen/guard.py`):

- a reworded bullet may not contain a number that is not in your original bullet;
- technical terms (AWS, C++, Node.js, CI/CD, PostgreSQL…) and any keyword from the job ad must be
  backed by the original bullet or the skills linked to it, including those skills' `aliases`;
- unknown ids, bullets attached to the wrong job, and requirement "matches" without evidence are removed.

When a check fails, the tool keeps your original wording and lists the problem in
`match_report.md`. Requirements you don't meet are listed as **gaps** in the report and are
never added to the CV. Use `--strict` to turn off rewording completely.

## Setup

```bash
cd cv-generator
pip install -r requirements.txt
# For PDF export, install LibreOffice (free): https://www.libreoffice.org
#   macOS: brew install --cask libreoffice   Ubuntu: sudo apt install libreoffice-writer
export ANTHROPIC_API_KEY=sk-ant-...           # https://console.anthropic.com
cp profile/profile.example.yaml profile/profile.yaml   # then fill in YOUR facts
python -m cvgen check-profile
```

`profile/profile.yaml`, your own template and `output/` are git-ignored, so your personal data
stays on your computer.

## Command line (alternative)

```bash
# From a job URL
python -m cvgen generate --job "https://careers.example.com/jobs/12345" --pdf

# Sites that block scripts or need a login (LinkedIn, some ATS portals):
# copy the job text into a file and pass that instead
python -m cvgen generate --job job.txt --pdf

# Use your own Word template
python -m cvgen generate --job job.txt --template templates/my_template.docx --pdf

# Never reword anything (original bullets and summary only)
python -m cvgen generate --job job.txt --strict --pdf

# After editing the template, re-render without a new API call
python -m cvgen generate --job job.txt --plan output/<folder>/plan.json --pdf

# Preview what the tool reads from a URL
python -m cvgen fetch-job "https://careers.example.com/jobs/12345"
```

Each run creates `output/<date>_<name>_<company-job>/` containing:

- `CV_<name>.docx` and `.pdf`: the tailored CV
- `match_report.md`: requirements met / partial / missing with evidence, gaps, ATS keywords,
  cover-letter talking points, and every correction the truth guard made
- `plan.json`, `job.txt`: what was used, so you can re-render or audit the result

See `examples/` for a sample job, plan, report and the resulting `sample_cv.pdf`.

## Filling in your profile (`profile/profile.yaml`)

It works like a master CV, with everything included:

- **Add more than fits on one page**: every role, achievement, project, tool and certificate.
  The tailor picks the best subset for each job.
- **Write bullets as achievements with numbers**: "Cut release time from one day to 20 minutes".
  Numbers must be in your bullets to appear in the CV.
- **Link bullets to skills** (`skills: [kubernetes, aws]`). This lets the bullet use the job ad's
  vocabulary for that skill.
- **Use `aliases` for true synonyms** (`Kubernetes → K8s, container orchestration`). An alias
  allows that wording, so only add synonyms that really describe your work.
- `headlines`: titles you are comfortable using about yourself.
- `summaries`: your own pre-written summary, used as a fallback and in `--strict` mode.
- `settings`: CV language, date style and summary length, e.g. for a German CV:

```yaml
settings:
  date_style: numeric      # 10/2025 instead of Oct 2025
  present_label: heute
  cv_language: de
  summary_max_words: 45
```

## Using your own template

The template is a normal Word document with placeholders ([docxtpl](https://docxtpl.readthedocs.io)
/ Jinja syntax). To turn your current CV into a template:

1. Open your CV in Word and save a copy as `templates/my_template.docx`.
2. Replace your content with tags, keeping all fonts, colours and layout:
   - simple values: `{{ name }}`, `{{ headline }}`, `{{ email }}`, `{{ phone }}`, `{{ location }}`, `{{ summary }}`
   - repeating blocks: put the tag on its own paragraph with `{%p ... %}`:

```
{%p for job in experience %}
{{ job.title }} — {{ job.company }}          {{ job.dates }}
{{ job.location }}
{%p for b in job.bullets %}
• {{ b.text }}                       ← a paragraph in your bullet style
{%p endfor %}
{%p endfor %}
```

   - in table rows use `{%tr for ... %}`; inside a single paragraph use `{% ... %}`.
   Static parts (photo, name, address…) can stay as plain text in the template.
3. Look at `templates/default.docx` (built by `templates/build_default_template.py`) for a full
   example, and run `python -m cvgen template-vars templates/my_template.docx` to check your tags.

Available variables:

| Variable | Contents |
|---|---|
| `name`, `headline`, `email`, `phone`, `location`, `date_of_birth`, `nationality` | strings |
| `photo` | your photo (if `personal.photo` is set) – put `{{ photo }}` where it goes |
| `links` | list of `{label, url}` |
| `summary` | tailored profile paragraph |
| `experience` | list of `{title, company, location, dates, start, end, employment_type, description, bullets[{text}]}` |
| `skill_groups` | list of `{category, joined, items[{name, level, years}]}` |
| `skills_by_level` | skills that have a `level`, grouped: `[{level: "Sehr gut", joined: "Python, Java"}]` |
| `skill_groups_unleveled` | like `skill_groups`, but only skills without a level (`g.joined_unleveled`) |
| `publications` | list of `{citation, year, url}` (chosen per job) |
| `awards`, `activities` | lists of `{text, date}` (always all) |
| `education` | list of `{degree, institution, location, dates, grade, details[]}` |
| `projects` | list of `{name, role, date, url, description}` |
| `certifications` | list of `{name, issuer, date, url}` |
| `languages` / `languages_joined` | list of `{name, level}` / "German (Native), English (C1)" |
| `interests` / `interests_joined` | list / comma-separated string |
| `job.title`, `job.company` | the target job (e.g. for a "Application for …" line) |

## Configuration

| Env var / flag | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Your Anthropic API key |
| `--model` / `CVGEN_MODEL` | `claude-opus-5-5` | Claude model used for tailoring |
| `--effort` | `high` | Reasoning effort (`low` … `max`) |

A tailoring run costs a few cents. Requests use Anthropic's server-side fallback
(`fallbacks: "default"`), so a request a safety classifier declines is re-run on a recommended
fallback model instead of failing.

## Tests

```bash
pip install pytest && python -m pytest -q tests
```

The tests run without an API key. They feed made-up claims (new numbers, invented technologies,
job keywords) through the guard and check that each one is caught.
