/**
 * Local Greek defect triage — deterministic keyword classifier (no LLM).
 * Maps free-text Greek descriptions to `trade` + `urgency` + `category` hints.
 * Runs fully on-prem, no data leaves the host (AI_LOCAL_ONLY compliant).
 */

export type DefectTrade = 'Υδραυλικά' | 'Ηλεκτρολογικά' | 'Κλιματισμός' | 'Ανελκυστήρας' | 'Καθαριότητα' | 'Κοινόχρηστα' | 'Γενικά';
export type DefectUrgency = 'low' | 'medium' | 'high';
export type DefectCategoryHint = 'Υδραυλικά' | 'Ηλεκτρολογικά' | 'Θέρμανση' | 'Ανελκυστήρας' | 'Καθαριότητα' | 'Κοινόχρηστα' | 'Άλλο';

export interface DefectClassification {
  trade: DefectTrade;
  urgency: DefectUrgency;
  categoryHint: DefectCategoryHint;
  keywords: string[];
  confidence: number; // 0..100
}

const TRADE_KEYWORDS: Record<DefectTrade, string[]> = {
  'Υδραυλικά': ['νερο', 'διαρρο', 'σωλην', 'βρυση', 'τουαλετ', 'νιπτηρ', 'υδραυλ', 'πλημμυρ', 'θερμοσιφων', 'καλοριφερ', 'βελ', 'αποχετευσ', 'σιφων'],
  'Ηλεκτρολογικά': ['ρευμα', 'ηλεκτρ', 'λαμπα', 'φως', 'πριζ', 'διακοπτη', 'καλωδ', 'βραχυκυκλ', 'πινακας', 'ασφαλεια'],
  'Κλιματισμός': ['κλιματισ', 'καυστήρ', 'λεβητ', 'πετρελ', 'θερμανσ', 'ψυξη', 'κλιμα', 'air condition'],
  'Ανελκυστήρας': ['ασανσερ', 'ανελκυστηρ', 'θαλαμ', 'κολλησ', 'πλατφορμ'],
  'Καθαριότητα': ['καθαριο', 'σκουπιδ', 'καδο', 'μυρι', 'εντομ', 'κατσαριδ', 'ποντικ'],
  'Κοινόχρηστα': ['κοινοχρηστ', 'εισοδ', 'κλιμακοστασ', 'ταρατσα', 'στεγη', 'υπογειο', 'γκαραζ', 'πυλωτ'],
  'Γενικά': [],
};

const URGENCY_HIGH = ['πλημμυρα', 'πλημμυρ', 'διαρροη μεγαλη', 'φωτια', 'καπνο', 'βραχυκυκλωμα', 'ρευμα κοπηκε', 'ασανσερ κολλησε', 'ατομο εγκλωβ', 'μυριζει αεριο', 'αεριο'];
const URGENCY_MEDIUM = ['σταζει', 'τρεχει νερο', 'δεν αναβει', 'χαλασμενο', 'σπασμενο', 'βουλ', 'μυριζει', 'θορυβ'];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents for matching, keep base Greek
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreTrade(normalized: string, keywords: string[]): { score: number; hits: string[] } {
  const hits: string[] = [];
  let score = 0;
  for (const kw of keywords) {
    const nkw = normalize(kw);
    if (normalized.includes(nkw)) {
      hits.push(kw);
      score += nkw.length > 5 ? 2 : 1;
    }
  }
  return { score, hits };
}

export function classifyDefectText(raw: string): DefectClassification {
  const text = raw.trim();
  if (!text) {
    return { trade: 'Γενικά', urgency: 'low', categoryHint: 'Άλλο', keywords: [], confidence: 0 };
  }
  const norm = normalize(text);

  // Trade scoring
  let bestTrade: DefectTrade = 'Γενικά';
  let bestScore = 0;
  let bestHits: string[] = [];
  for (const [trade, kws] of Object.entries(TRADE_KEYWORDS) as [DefectTrade, string[]][]) {
    if (trade === 'Γενικά') continue;
    const { score, hits } = scoreTrade(norm, kws);
    if (score > bestScore) {
      bestScore = score;
      bestTrade = trade;
      bestHits = hits;
    }
  }

  // Urgency
  let urgency: DefectUrgency = 'low';
  const hasHigh = URGENCY_HIGH.some((kw) => norm.includes(normalize(kw)));
  const hasMedium = URGENCY_MEDIUM.some((kw) => norm.includes(normalize(kw)));
  if (hasHigh) urgency = 'high';
  else if (hasMedium || bestScore >= 2) urgency = 'medium';
  else if (bestScore === 0) urgency = 'low';

  // Category hint mirrors trade but maps to ExpenseCategory names
  const categoryMap: Record<DefectTrade, DefectCategoryHint> = {
    'Υδραυλικά': 'Υδραυλικά',
    'Ηλεκτρολογικά': 'Ηλεκτρολογικά',
    'Κλιματισμός': 'Θέρμανση',
    'Ανελκυστήρας': 'Ανελκυστήρας',
    'Καθαριότητα': 'Καθαριότητα',
    'Κοινόχρηστα': 'Κοινόχρηστα',
    'Γενικά': 'Άλλο',
  };

  const confidence = Math.min(95, Math.max(10, bestScore * 18 + (urgency === 'high' ? 20 : 0) + (bestHits.length > 1 ? 15 : 0)));

  return {
    trade: bestTrade,
    urgency,
    categoryHint: categoryMap[bestTrade],
    keywords: bestHits.slice(0, 5),
    confidence: bestTrade === 'Γενικά' ? Math.min(confidence, 30) : confidence,
  };
}
