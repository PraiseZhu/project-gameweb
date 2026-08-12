import test from "node:test";
import assert from "node:assert/strict";
import { lint } from "../src/lint.mjs";

const box = (x, w = 10) => ({ x, y: 0, width: w, height: 10 });
const leaf = (id, name, x) => ({ id, name, type: "RECTANGLE", absoluteBoundingBox: box(x) });
const dupsOf = (tree) => lint(tree).findings.filter((f) => f.code === "N-NAME-DUPLICATE");

test("N-NAME-DUPLICATE：同一父层下两个不同资产同名要报", () => {
  const tree = {
    id: "root", name: "root", type: "FRAME", absoluteBoundingBox: box(0, 100),
    children: [leaf("a", "img/头像", 0), leaf("b", "img/头像", 20), leaf("c", "img/背景", 40)],
  };
  const dups = dupsOf(tree);
  assert.equal(dups.length, 2);
  assert.ok(dups.every((f) => f.detail.includes("img/头像")));
});

test("N-NAME-DUPLICATE：不同父层下同名不报——路径能区分它们", () => {
  // 规范稿实测：img/按钮背景 出现 4 次，分别在 4 个不同按钮里。
  // 按全稿去重会在合规稿上报 70 条假问题。
  const btn = (id, x) => ({
    id,
    name: "btn/按钮" + id,
    type: "FRAME",
    absoluteBoundingBox: box(x, 30),
    children: [leaf(id + "-bg", "img/按钮背景", x)],
  });
  const tree = {
    id: "root", name: "root", type: "FRAME", absoluteBoundingBox: box(0, 100),
    children: [btn("p", 0), btn("q", 40)],
  };
  assert.equal(dupsOf(tree).length, 0);
});

test("N-NAME-DUPLICATE：整组等价构件同名不报", () => {
  // §1 明写「ind/ 全组同名是允许的，序号按同级顺序推定」。
  // tab/ 的页签、ind/ 的圆点同理，逐个起名只会制造无意义的差异。
  const tree = {
    id: "r2", name: "tab/页签条", type: "FRAME", absoluteBoundingBox: box(0, 100),
    children: [leaf("t1", "btn/页签", 0), leaf("t2", "btn/页签", 20), leaf("t3", "btn/页签", 40)],
  };
  assert.equal(dupsOf(tree).length, 0);
});

test("N-NAME-DUPLICATE：同名的只占少数时仍要报——两个不构成一组", () => {
  const tree = {
    id: "r3", name: "容器", type: "FRAME", absoluteBoundingBox: box(0, 100),
    children: [
      leaf("u1", "img/图", 0),
      leaf("u2", "img/图", 20),
      leaf("u3", "img/别的", 40),
      leaf("u4", "img/再一个", 60),
    ],
  };
  assert.equal(dupsOf(tree).length, 2);
});
