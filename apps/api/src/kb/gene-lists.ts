/**
 * Small curated gene sets used by the rule engine. They are intentionally conservative;
 * labs can extend them. Sources: ClinGen dosage sensitivity (haploinsufficiency score 3),
 * ACMG SF v3.2, and commonly profiled cancer genes.
 */
export const LOF_MECHANISM_GENES = new Set([
  'APC', 'ATM', 'BAP1', 'BARD1', 'BMPR1A', 'BRCA1', 'BRCA2', 'BRIP1', 'CDH1', 'CDKN2A', 'CHEK2', 'DICER1',
  'EPCAM', 'FH', 'FLCN', 'MEN1', 'MLH1', 'MSH2', 'MSH6', 'MUTYH', 'NF1', 'NF2', 'PALB2', 'PMS2', 'POLD1',
  'POLE', 'PTCH1', 'PTEN', 'RAD51C', 'RAD51D', 'RB1', 'SDHA', 'SDHB', 'SDHC', 'SDHD', 'SMAD4', 'SMARCA4',
  'STK11', 'SUFU', 'TP53', 'TSC1', 'TSC2', 'VHL', 'WT1', 'LDLR', 'MYBPC3', 'KCNQ1', 'FBN1', 'TTN',
]);

export const CANCER_GENES = new Set([
  ...LOF_MECHANISM_GENES,
  'ABL1', 'AKT1', 'ALK', 'AR', 'ARID1A', 'BRAF', 'CCND1', 'CDK4', 'CDK6', 'CTNNB1', 'DDR2', 'EGFR', 'ERBB2',
  'ERBB3', 'ESR1', 'EZH2', 'FGFR1', 'FGFR2', 'FGFR3', 'FLT3', 'GNA11', 'GNAQ', 'GNAS', 'HRAS', 'IDH1', 'IDH2',
  'JAK2', 'KIT', 'KMT2A', 'KRAS', 'MAP2K1', 'MET', 'MTOR', 'MYC', 'MYCN', 'NOTCH1', 'NPM1', 'NRAS', 'NTRK1',
  'NTRK2', 'NTRK3', 'PDGFRA', 'PIK3CA', 'PIK3R1', 'RET', 'ROS1', 'SF3B1', 'SMO', 'SRC', 'TERT', 'TET2',
  'DNMT3A', 'ASXL1', 'RUNX1', 'CEBPA', 'U2AF1', 'SRSF2', 'KEAP1', 'NFE2L2', 'FBXW7', 'CREBBP', 'EP300',
]);

export const LOF_CONSEQUENCES = new Set([
  'stop_gained', 'frameshift_variant', 'splice_acceptor_variant', 'splice_donor_variant',
  'start_lost', 'transcript_ablation',
]);

/** Pharmacogenes handled by the PGx module (CPIC level A/B, callable from a VCF). */
export const PGX_GENES = new Set(['CYP2C19', 'CYP2C9', 'DPYD', 'TPMT', 'NUDT15', 'SLCO1B1', 'CYP3A5', 'VKORC1', 'UGT1A1', 'CYP2B6']);
