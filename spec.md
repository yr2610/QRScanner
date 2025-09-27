# qrscanner 送信側（QR表示）仕様

このドキュメントは、**受信側PWA（qrscanner）**が正しく復元できるように、**送信側（QR表示側）**が出力すべき文字列フォーマットと運用要件を定義します。

## 0. 用語

* **セッション**: 1回の転送単位（複数QRの束）。識別子は `sid`。
* **チャンク**: セッション内でQR1枚ぶんのデータ（`idx` 番目）。

---

## 1. 文字列フォーマット（1QR=1行）

```
Q4|<idxHex>/<totHex>|<sid>|<payload>
```

* 先頭マーカー: `Q4`（固定）
  ※必要なら `QRP4` 等に変更可能（受信側の正規表現も合わせて変更）
* `idxHex` / `totHex`: **1〜4桁の16進（大文字推奨）**

  * 制約: `1 ≤ idx ≤ tot ≤ FFFF(65535)`
* `sid`: **3〜4文字の英数字（大文字 Base36）** を推奨（例: `7Z2`, `A7K3`）
* `payload`: **gzip後のバイト列を Base64URL（パディング無し）**でエンコード
  文字集合: `A–Z a–z 0–9 - _`（区切り記号 `|` を使わない）

**受信側の想定正規表現**（新形式）

```
^Q4\|([0-9A-F]{1,4})/([0-9A-F]{1,4})\|([0-9A-Z]{3,4})\|(.*)$   // i フラグ可
```

※ 旧形式 `[idx/total]|session|payload`（10進）も後方互換で受理可能（任意）

---

## 2. エンコード手順（送信側）

1. 入力データ（テキスト/JSON等）を **UTF-8 バイト列**に変換
2. **gzip圧縮**（CompressionLevel: Optimal 推奨）
3. **Base64URL** エンコード（`+→-`, `/→_`, **`=` パディングは削除**）
4. 上記フォーマットに従い **分割**＆**連番化** してQRへ出力

---

## 3. 分割ポリシ（推奨値）

* 1枚あたりの `payload` 文字数: **約 600〜800 文字**（まずは **700** で開始）
* QRの誤り訂正レベル: **M 〜 Q**（安定重視なら Q、容量重視なら M）
* 画面レイアウト: **白背景／黒コード**、画面の **30〜50%** 程度のサイズ
* 表示時間: **2〜3秒/枚**
* ループ: `idx=1→…→tot` を **一定間隔で繰り返し**（取りこぼし対策）

---

## 4. セッションID（`sid`）生成

* 3〜4文字の **Base36（0–9,A–Z）** ランダム/時刻混在でOK
* 例: `sid = Base36(now_unix_seconds % 36^4)` 等

---

## 5. オプション（推奨）

### 5.1 チャンクCRC（軽量の局所検査）

* 各QR末尾に **`~` + CRC8（2桁Hex）** を追加:

  ```
  Q4|<idx>/<tot>|<sid>|<payload>~<crc2>
  ```
* CRC8 対象: `payload` のバイト列
* 受信側はCRC不一致のチャンクを**無視**し、次ループで再読を期待

### 5.2 全体CRC（復元後整合性の検査）

* **最終チャンク**の `payload` に `|CRC32=<8桁Hex>` を付与
* 受信後、結合した元バイト列に対して CRC32 を再計算・照合

---

## 6. 表示UI要件（最小）

* **開始/停止**（スタートでループ送出、停止で固定）
* **ループ間隔**の固定（2〜3秒）
* 画面に **現在の `idx/total`** を明示表示（受信側の目視補助）
* 任意: **前へ/次へ** の手動操作

---

## 7. テスト用ミニ例

* 入力: `{"msg":"hello","n":1}`
* gzip → Base64URL（例）: `H4sIAAAAA...`（省略）
* `tot=3`, `sid=7Z2` の出力例:

```
Q4|1/3|7Z2|H4sIAAAAA...
Q4|2/3|7Z2|ti63_LC...
Q4|3/3|7Z2|ABCD123...
```

---

## 8. 参考実装（パッカー）

### 8.1 Python

```python
import gzip, base64, math, secrets, string

def b64url_nopad(b: bytes) -> str:
    s = base64.urlsafe_b64encode(b).decode('ascii')
    return s.rstrip('=')

def make_sid(length=3):
    alphabet = string.digits + string.ascii_uppercase  # 0-9A-Z
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def pack_to_qr_lines(data_bytes: bytes, payload_len=700, sid=None):
    if sid is None:
        sid = make_sid(3)
    gz = gzip.compress(data_bytes)
    payload = b64url_nopad(gz)
    parts = [payload[i:i+payload_len] for i in range(0, len(payload), payload_len)]
    tot = len(parts)
    if tot < 1 or tot > 0xFFFF:
        raise ValueError('total out of range')
    lines = []
    for i, p in enumerate(parts, start=1):
        idx = format(i, 'X')    # HEX（大文字）
        tt  = format(tot, 'X')
        lines.append(f"Q4|{idx}/{tt}|{sid}|{p}")
    return lines, sid
```

### 8.2 C# (.NET 6)

```csharp
using System; using System.IO; using System.IO.Compression; using System.Security.Cryptography; using System.Text; using System.Collections.Generic;

static string Base64UrlNoPad(byte[] bytes)
{
    var s = Convert.ToBase64String(bytes).Replace('+','-').Replace('/','_').TrimEnd('=');
    return s;
}
static string MakeSid(int len=3)
{
    const string chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var rng = RandomNumberGenerator.Create();
    var buf = new byte[len]; rng.GetBytes(buf);
    var sb = new StringBuilder(len);
    foreach (var b in buf) sb.Append(chars[b % chars.Length]);
    return sb.ToString();
}
static (List<string> lines, string sid) PackToQrLines(byte[] data, int payloadLen = 700, string? sid = null)
{
    sid ??= MakeSid(3);
    using var msIn = new MemoryStream(data);
    using var msOut = new MemoryStream();
    using (var gz = new GZipStream(msOut, CompressionLevel.Optimal, leaveOpen:true))
        msIn.CopyTo(gz);
    var gzBytes = msOut.ToArray();
    var b64u = Base64UrlNoPad(gzBytes);

    var lines = new List<string>();
    int tot = (int)Math.Ceiling(b64u.Length / (double)payloadLen);
    if (tot < 1 || tot > 0xFFFF) throw new ArgumentOutOfRangeException(nameof(tot));
    for (int i=0; i<tot; i++)
    {
        var chunk = b64u.Substring(i*payloadLen, Math.Min(payloadLen, b64u.Length - i*payloadLen));
        string idxHex = (i+1).ToString("X");
        string totHex = tot.ToString("X");
        lines.Add($"Q4|{idxHex}/{totHex}|{sid}|{chunk}");
    }
    return (lines, sid);
}
```

---

## 9. 互換性とリカバリ

* 受信側は **新形式 `Q4|...` を優先**し、旧形式 `[idx/total]|session|payload` も任意で受理可（後方互換）。
* 取りこぼし: 送信側はループ、受信側は不足番号を表示 → 次ループで回収。
* 誤読: CRC導入時は不一致チャンクを無視。CRC無しでも `sid/idx/tot` の不整合は受信側で無視されるため混在を抑制。
