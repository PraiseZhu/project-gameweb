/**
 * 未规范稿机器前置链路的唯一实现。
 * catalog 只检索不写盘；写回走 gold-morphology；闸门走 completeness CLI 同一入口。
 * 夜间评测必须调用本文件，禁止再抄词表或漏传冻住前缀类。
 */
import { loadClassRoles, loadSettledRules, loadSignatureEvidence, loadSignatureRoles, matchInventoryToCatalog } from "./module-catalog.mjs";
import { finalizeDraftWriteback } from "./gold-morphology.mjs";
import { auditLikeCli } from "../scripts/check-draft-asset-completeness.mjs";

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function runDraftMachinePipeline(docs, catalog, options = {}) {
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error("runDraftMachinePipeline 需要至少一份 draft");
  }
  const clones = docs.map((doc) => cloneJson(doc));
  const catalogHits = clones.map((doc) => (catalog ? matchInventoryToCatalog(doc, catalog) : []));
  const classRoles = options.classRoles ?? loadClassRoles();
  const signatureRoles = options.signatureRoles ?? loadSignatureRoles();
  const signatureEvidence = options.signatureEvidence ?? loadSignatureEvidence();
  const settledRules = options.settledRules ?? loadSettledRules();
  const writeback = finalizeDraftWriteback(clones, {
    classRoles,
    signatureRoles,
    signatureEvidence,
    settledRules,
    geometryEvidence: options.geometryEvidence ?? true,
  });
  const completeness = clones.map((doc, index) => {
    const peers = clones.filter((_, other) => other !== index);
    return auditLikeCli(doc, peers, {
      classRoles,
      signatureRoles,
      signatureEvidence,
      settledRules,
      referenceDoc: options.referenceDoc,
    });
  });
  return {
    docs: clones,
    catalogHits,
    applied: writeback.applied,
    counts: writeback.counts,
    completeness,
  };
}
