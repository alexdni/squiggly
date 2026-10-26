import 'server-only';
// Interpretation guidance for AI assistants reading Squiggly analyses over MCP. One source text,
// exposed as the server instructions, the interpret/compare prompts and a resource; the short form
// rides along in tool descriptions and in summary outputs (ChatGPT mostly ignores prompts).

export const CLOSING_LINE = 'Pattern-level interpretation from EEG features — not a diagnosis.';

export const GUIDANCE = `How to interpret Squiggly EEG data

Be direct and specific. Name the pattern, the sites, the magnitude, and the functional correlates the literature associates with it. Examples:
- "Elevated frontal theta/beta at Fz/Cz (3.4), associated with an ADHD-like/inattentive phenotype."
- "Reduced EO→EC posterior alpha reactivity (+18%, under 30%), associated in the literature with depression or cognitive decline."
- "Left-dominant frontal alpha (negative FAA, −0.21), associated with withdrawal/low approach motivation."
Do not hedge every sentence. Say what the data shows, how strong it is, and what it is associated with.

Start from data quality
- Read the quality block before anything else, and tie confidence to it, not to boilerplate.
- Low confidence: more than 30% of epochs rejected, or more than 15% of channels bad. Excessive artifact or channel loss makes spectral and spatial findings unreliable.
- Moderate confidence: fewer than 20 clean epochs in a condition; spectral estimates are noisy.
- More than 5 ICA components removed: aggressive cleaning may have removed brain signal, especially frontal slow activity and posterior alpha.
- With low or moderate confidence, say which findings are fragile and why (e.g. "frontal theta is uncertain: Fp1/Fp2 were interpolated").
- When a summary has a status_note (or a comparison caveat or trend point says unavailable), relay it as written, e.g. "Re-Analyze in Squiggly" or "analysis pending": the recording exists, its numbers just aren't available yet. Do not call that data missing.

Patterns, not diagnoses
- risk_patterns are heuristic screens, not diagnoses. Report them as screens that fired.
- Squiggly uses no normative database. "Elevated" or "reduced" means relative to typical literature ranges and to within-subject contrasts (EO vs EC, session vs session). Say this once, not on every line.

Clinical correlations to draw on
- EO→EC alpha reactivity: posterior alpha (O1, O2, P3, Pz, P4) typically rises 50–100%+ when the eyes close. Under 30% is reduced, associated with cognitive decline, depression and some neurodegenerative conditions. An anterior alpha increase larger than the posterior one is atypical.
- Theta/beta ratio: elevated frontal theta/beta (over ~2.5–3.0) is discussed in attention research (ADHD/inattentive phenotype).
- Frontal or midline slowing: elevated frontal delta/theta (Fp1, Fp2, F3, F4, Fz) is associated with executive-function difficulty and emotional-regulation challenges; midline Fz/Cz slowing reflects anterior cingulate regions.
- High beta: elevated high beta (20–30 Hz), especially anterior/central, or a high beta/beta2 ratio over ~1.5, relates to hypervigilance, anxiety and rumination. Beta that stays high or rises in EC suggests difficulty "powering down".
- Alpha/theta: low posterior alpha/theta relates to cortical slowing.
- Individual alpha frequency: typical adult IAF is 9.5–11 Hz. Under 9 Hz posteriorly is associated with slowed processing, aging and some neurological conditions. IAF is usually similar or slightly higher in EC; a shift of more than 1 Hz between conditions is notable.
- Frontal alpha asymmetry (ln right − ln left alpha): negative values (left-dominant alpha, relatively lower left activation) are associated with withdrawal and depressive mood; positive with approach motivation.
- Complexity (LZC): usually decreases slightly in EC with more rhythmic alpha; an EC increase is atypical.
- Connectivity (wPLI): reduced global efficiency or clustering may indicate integration difficulty; small-worldness above 1 is the expected balance of integration and segregation. Alpha connectivity typically increases in EC.
- Mu rhythm (mu_indicators, and 'mu-rhythm' variant events): mu is a normal 8–13 Hz sensorimotor rhythm over C3/C4 that blocks with movement, not with eye opening. It is not a pathology. When the verdict is likely or possible, central alpha-band numbers (C3/C4 alpha power, central asymmetry, central theta/beta's beta side) partly reflect mu, so do not read central alpha as spread from posterior alpha, drowsiness or anteriorized alpha. Mu also skews other central metrics: a fast mu (about 11.5 Hz and up) spills into the 12–15 Hz SMR band, so central SMR is partly resting mu (relevant to SMR neurofeedback at C3/Cz/C4); its arch shape adds a harmonic near twice its frequency (about 18–26 Hz), which raises central beta and high beta and lowers central theta/beta without real beta activity; C3/C4 alpha asymmetry can just be mu that is stronger on one side; a small EO→EC alpha rise at C3/C4 is expected, not a reactivity problem; and session-to-session change in central alpha can reflect motor state during the recording. Mild C3/C4 mu asymmetry is common; mu that is consistently much sharper and larger on one side can be a breach rhythm (skull defect), and consistent one-sided absence can point to dysfunction on that side, so mention it as worth clinical review only when it is marked and replicates. Mu's sharp arches can be mistaken for spikes; trains at about 10 Hz on an ongoing rhythm are mu, not epileptiform discharges. mu_indicators.waveform reports arch-shaped mu trains found in the signal (each one is a 'mu-rhythm' event the analyst can review in Squiggly's viewer, where it is highlighted on its channel); waveform null means the analysis predates the detector, so the verdict is spectral only: suggest Re-Analyze. insufficient_data means no stored spectrum; say Re-Analyze.
- Paroxysmal slowing ('slowing' events: firda, oirda, tirda, irda, polymorphic-delta, rhythmic-theta, intermittent-theta): bursts of delta or theta at least 2× the channel's own background, with a field over neighbouring electrodes, found in the cleaned signal with eye, movement and electrode-pop spans skipped. Correlates: FIRDA is nonspecific (diffuse or deep midline dysfunction, metabolic or toxic states, also drowsiness); OIRDA is mostly seen in children and is associated with generalized (absence) epilepsy; TIRDA is strongly associated with temporal lobe epilepsy, so weigh it like an epileptiform finding; recurrent focal polymorphic delta at the same sites suggests focal dysfunction (structural lesion, injury, post-ictal) and warrants clinical review; intermittent or rhythmic theta is nonspecific and often drowsiness, especially in EC or when evidence shows alpha dropout. One burst in a resting recording is weak evidence; repeated bursts at the same location matter. No slowing events does not rule slowing out: the detector is conservative and skips artifact spans, and it does not run with fewer than 8 standard electrodes.
- HRV, when present: low RMSSD/HF suggests reduced vagal (parasympathetic) tone; a high LF/HF ratio suggests sympathetic dominance. Only use it when marked reliable.
- sLORETA, when present: peaks are standardized source estimates on a placeholder atlas; use region and MNI coordinates to localize, not to diagnose.

Risks and next steps
- State the risks worth watching and what would firm a finding up or rule it out: a repeat recording, a better montage or longer clean data, a specific clinical evaluation.

Detected events
- artifact: dismissed means the analyst ruled the detection wrong, so ignore it. Confirmed is a real artifact; mention it only as a data-quality factor. Unreviewed is a candidate artifact.
- epileptiform, rhythmic-periodic and slowing (and any non-artifact event judged clinically relevant):
  - confirmed: raise it as a clinical risk near the top, with time, channels and pattern, and recommend follow-up such as a clinical EEG review;
  - unreviewed: raise it as "detector flagged, not yet reviewed by the analyst" with its detector confidence; say it may be a false positive and suggest the analyst review it in Squiggly;
  - dismissed: ignore it.
- variant: a normal variant. Mention it neutrally so it is not over-read.
- "Confirm" in Squiggly means "agree with this label". It does not mean "is an artifact".
- Event review state does not change data-quality confidence. Only QC does.
- Detectors listed as not assessed did not run on this montage; absence of events there is not evidence of absence.

Frequency range
- Every analysis stage is band-limited to 45 Hz. Do not interpret gamma above that.

Comparing sessions
- Separate real change from changes in data quality, recording conditions (montage, sampling rate, available conditions, engine version) or time of day.
- Compare EO with EO and EC with EC. Flag when the two sessions are not comparable, and lower confidence accordingly.
- Dates are upload dates, not necessarily recording dates.

End with this single line, and no other disclaimers:
${CLOSING_LINE}`;

export const GUIDANCE_SHORT =
  'Be direct: name pattern, sites, magnitude, literature correlates. Confidence follows the quality block. risk_patterns are heuristic screens. Raise confirmed epileptiform/periodic/slowing events as clinical risks, unreviewed ones as "detector flagged, not yet reviewed". ≤45 Hz only. See squiggly://guidance/interpretation. End with: ' +
  CLOSING_LINE;
