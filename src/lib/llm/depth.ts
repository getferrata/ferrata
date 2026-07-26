import type { DepthPreset } from "@/db/schema";

/**
 * Turn the course's depth preset into guidance injected into the intake and
 * write_module prompts. Two levers: how much the graph EXPANDS (intake adds
 * prerequisite concepts) and how much each module EXPLAINS inline.
 */
export function intakeDepthGuidance(preset: DepthPreset): string {
  switch (preset) {
    case "overview":
      return "PROFONDITÀ scelta: Panoramica. Lo studente ha già le basi. Tieni la lista di concetti corta e ad alto livello, taglia con decisione, NON aggiungere concetti-prerequisito di base.";
    case "scratch":
      return "PROFONDITÀ scelta: Da zero. Lo studente parte quasi da niente. AGGIUNGI come concetti a sé i prerequisiti di base (per BGP, includi anche indirizzamento IP, TCP, basi di routing). Più concetti, più fondamenta.";
    default:
      return "PROFONDITÀ scelta: Operativo (default). Profondità standard: concreto e operativo, senza insegnare ogni prerequisito da zero.";
  }
}

export function moduleDepthGuidance(preset: DepthPreset): string {
  switch (preset) {
    case "overview":
      return "Profondità: panoramica. Vai stretto; puoi dare per noti i termini di base.";
    case "scratch":
      return "Profondità: da zero. Assumi poco: quando usi un termine di base che lo studente potrebbe non sapere (cos'è un IP, cos'è il TCP), spiegalo in una frase o un breve inciso: scendi di un livello sotto questo concetto.";
    default:
      return "Profondità: operativo. Spiega il concetto in modo concreto; assumi un background generale ma non un'expertise profonda.";
  }
}
