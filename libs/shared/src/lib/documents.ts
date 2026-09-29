export interface BuildingDocument {
  id: string;
  buildingId: string;
  /** Free-form category, e.g. ΚΑΝΟΝΙΣΜΟΣ / ΠΡΑΚΤΙΚΟ / ΤΙΜΟΛΟΓΙΟ. */
  type: string;
  fileName: string;
  sizeBytes: number;
  uploadedById: string;
  uploaderName?: string;
  createdAt: string;
}
