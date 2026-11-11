import type { ColumnFacet } from "../deck/column-kinds";
import type { ColumnShow } from "../deck/deck";
import { COMMENT_KIND } from "../nostr/comment";
import type { NostrEvent } from "../nostr/event";
import { quoteTargets } from "../nostr/quote";
import { isReply } from "../nostr/reply";

/**
 * カラム設定の「表示するもの」で流れを間引く。購読は変えない ——
 * 設定を戻したときに取り直しにならないよう、絞り込みは描くときだけ行う。
 *
 * `facets` はそのカラムで意味を持つ項目（`columnFacets`）。含まれない項目では
 * 間引かない —— 例えば「メンション」はホームでは意味を持たず、適用すると
 * 普通の投稿まで消える。
 */
export const visibleColumnItems = (
  events: readonly NostrEvent[],
  show: ColumnShow,
  facets: readonly ColumnFacet[],
): NostrEvent[] => {
  const off = (facet: ColumnFacet) => facets.includes(facet) && !show[facet];
  return events.filter((event) => {
    if (off("reposts") && (event.kind === 6 || event.kind === 16)) return false;
    if (off("reactions") && event.kind === 7) return false;
    if (off("zaps") && event.kind === 9735) return false;
    if (off("chats") && event.kind === 42) return false;
    if (event.kind !== 1 && event.kind !== COMMENT_KIND) return true;
    // 返信と引用は別物。返信でもある引用は返信として扱い、片方だけを切っても消えない。
    if (isReply(event)) return !off("replies");
    if (quoteTargets(event).length > 0) return !off("quotes");
    return !off("mentions");
  });
};

/**
 * 投稿者ごとに、新しい方から `perAuthor` 件だけ残す。`events` は新しい順に
 * 並んでいること（読む層はその順で返す）。`undefined` なら何も落とさない。
 *
 * 購読は変えずに描くときだけ間引く —— フォローしている人を 1 人ずつ
 * `limit` 付きで読み直すと、リレーごとのフィルタが人数ぶんに増える。
 */
export const latestPerAuthor = (
  events: readonly NostrEvent[],
  perAuthor: number | undefined,
): NostrEvent[] => {
  if (perAuthor === undefined || perAuthor < 1) return [...events];
  const kept = new Map<string, number>();
  return events.filter((event) => {
    const count = kept.get(event.pubkey) ?? 0;
    if (count >= perAuthor) return false;
    kept.set(event.pubkey, count + 1);
    return true;
  });
};
