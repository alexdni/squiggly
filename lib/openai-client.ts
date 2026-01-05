import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export interface AIInterpretationContent {
  summary: string;
  amplitude_patterns: string;
  frequency_ratios: string;
  peak_alpha_frequency: string;
  asymmetry_analysis: string;
  complexity_connectivity: string;
  observations: string;
}

export interface AIInterpretation {
  generated_at: string;
  model: string;
  content: AIInterpretationContent;
}

export async function generateEEGInterpretation(
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number = 60000
): Promise<AIInterpretationContent> {
  const client = getOpenAIClient();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await client.chat.completions.create(
      {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2000,
        temperature: 0.7,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    return parseInterpretationResponse(content);
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('OpenAI request timed out');
    }
    if (error.status === 429) {
      throw new Error('OpenAI rate limit exceeded');
    }
    if (error.status === 401) {
      throw new Error('OpenAI authentication failed');
    }
    throw error;
  }
}

function parseInterpretationResponse(content: string): AIInterpretationContent {
  // Parse structured sections from the response
  const sections: AIInterpretationContent = {
    summary: '',
    amplitude_patterns: '',
    frequency_ratios: '',
    peak_alpha_frequency: '',
    asymmetry_analysis: '',
    complexity_connectivity: '',
    observations: '',
  };

  // Try to parse sections based on headers
  const sectionPatterns: { key: keyof AIInterpretationContent; patterns: RegExp[] }[] = [
    { key: 'summary', patterns: [/##?\s*Summary[:\s]*/i, /##?\s*Overview[:\s]*/i] },
    { key: 'amplitude_patterns', patterns: [/##?\s*Amplitude\s*Patterns?[:\s]*/i, /##?\s*Band\s*Power[:\s]*/i] },
    { key: 'frequency_ratios', patterns: [/##?\s*Frequency\s*Ratios?[:\s]*/i, /##?\s*Ratios?[:\s]*/i] },
    { key: 'peak_alpha_frequency', patterns: [/##?\s*Peak\s*Alpha[:\s]*/i, /##?\s*Individual\s*Alpha[:\s]*/i, /##?\s*IAF[:\s]*/i, /##?\s*Alpha\s*Peak[:\s]*/i] },
    { key: 'asymmetry_analysis', patterns: [/##?\s*Asymmetry[:\s]*/i, /##?\s*Hemispheric[:\s]*/i] },
    { key: 'complexity_connectivity', patterns: [/##?\s*Complexity[:\s]*/i, /##?\s*Connectivity[:\s]*/i, /##?\s*LZC[:\s]*/i] },
    { key: 'observations', patterns: [/##?\s*Observations?[:\s]*/i, /##?\s*Clinical\s*Observations?[:\s]*/i, /##?\s*Additional[:\s]*/i] },
  ];

  // Split content by section headers
  let remainingContent = content;
  const foundSections: { key: keyof AIInterpretationContent; start: number; text: string }[] = [];

  for (const { key, patterns } of sectionPatterns) {
    for (const pattern of patterns) {
      const match = remainingContent.match(pattern);
      if (match && match.index !== undefined) {
        foundSections.push({ key, start: match.index, text: '' });
        break;
      }
    }
  }

  // Sort by position and extract content
  foundSections.sort((a, b) => a.start - b.start);

  for (let i = 0; i < foundSections.length; i++) {
    const current = foundSections[i];
    const nextStart = i < foundSections.length - 1 ? foundSections[i + 1].start : content.length;

    // Find the actual start after the header
    let headerEnd = current.start;
    for (const { patterns } of sectionPatterns.filter(sp => sp.key === current.key)) {
      for (const pattern of patterns) {
        const match = content.slice(current.start).match(pattern);
        if (match) {
          headerEnd = current.start + match[0].length;
          break;
        }
      }
    }

    sections[current.key] = content.slice(headerEnd, nextStart).trim();
  }

  // If no sections found, put everything in summary
  if (foundSections.length === 0) {
    sections.summary = content.trim();
  }

  return sections;
}
