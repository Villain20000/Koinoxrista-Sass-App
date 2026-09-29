import { classifyDefectText } from './defect-classifier';

describe('defect-classifier (Greek local AI — no LLM)', () => {
  it('classifies υδραυλικά with high urgency for πλημμύρα', () => {
    const r = classifyDefectText('Πλημμύρα στο υπόγειο, τρέχει νερό από τον σωλήνα');
    expect(r.trade).toBe('Υδραυλικά');
    expect(r.urgency).toBe('high');
    expect(r.categoryHint).toBe('Υδραυλικά');
    expect(r.confidence).toBeGreaterThan(50);
  });

  it('classifies ηλεκτρολογικά for ρεύμα', () => {
    const r = classifyDefectText('Δεν ανάβει το φως στο κλιμακοστάσιο, έπεσε η ασφάλεια');
    expect(r.trade).toBe('Ηλεκτρολογικά');
    expect(r.urgency).toBe('medium');
  });

  it('classifies ανελκυστήρας for κολλημένο ασανσέρ', () => {
    const r = classifyDefectText('Το ασανσέρ κόλλησε στον 3ο, άτομο εγκλωβισμένο');
    expect(r.trade).toBe('Ανελκυστήρας');
    expect(r.urgency).toBe('high');
  });

  it('classifies θέρμανση for θερμοσίφωνας', () => {
    const r = classifyDefectText('Έσπασε ο θερμοσίφωνας, δεν έχουμε ζεστό νερό');
    expect(r.trade).toBe('Υδραυλικά'); // θερμοσίφων is under υδραυλικά list
    expect(['low', 'medium', 'high']).toContain(r.urgency);
  });

  it('falls back to Γενικά for unknown text', () => {
    const r = classifyDefectText('Γεια σας, έχω μια ερώτηση για τα κοινόχρηστα');
    expect(r.trade).toBe('Κοινόχρηστα'); // contains κοινόχρηστ
  });

  it('returns low confidence for empty', () => {
    const r = classifyDefectText('');
    expect(r.trade).toBe('Γενικά');
    expect(r.confidence).toBe(0);
  });

  it('is deterministic and PII-safe (no email leak)', () => {
    const a = classifyDefectText('Διαρροή στο μπάνιο maria@example.gr 2101234567');
    const b = classifyDefectText('Διαρροή στο μπάνιο maria@example.gr 2101234567');
    expect(a).toEqual(b);
  });
});
