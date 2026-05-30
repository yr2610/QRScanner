# QRScanner

QRScanner は Q4Sender が表示する QR コード列をカメラで読み取り、元ファイルを復元するためのブラウザ/PWAアプリです。

## 全体の流れ

1. Windows 側で Q4Sender を起動します。
2. Q4Sender で送信したいファイルを開きます。
3. Q4Sender の `Mode` は通常 `Fountain` のまま使います。
4. QRScanner を HTTPS または localhost で開きます。
5. QRScanner 側でも同じ `Mode` を選びます。
6. QRScanner の `読み取り開始` を押します。
7. Q4Sender が表示する QR コード列にカメラを向けます。
8. `復元完了` が表示されたら完了です。

復元完了時には自動保存を試みます。必要に応じて `ファイル保存` や `共有` も使えます。

## Q4Sender 側

Q4Sender は Windows フォームアプリです。ファイルを QR コード列に変換し、一定間隔で表示します。

### 基本操作

1. Q4Sender を Windows で起動します。
2. `Mode` を選びます。通常は `Fountain` を選びます。
3. 送信したいファイルを開きます。
4. QR コードの表示速度や設定を必要に応じて調整します。
5. QRScanner で読み取ります。

### Fountain 生成の注意

Fountain モードでは Wirehair ベースの `Q4W` フレームを生成します。

Q4Sender 側の Fountain 生成には同梱の JavaScript ヘルパーを使うため、Windows に Node.js がインストールされていて、`node` コマンドが実行できる必要があります。

### Legacy Q4

Legacy Q4 は従来方式です。`Q4|...` フレームを固定順序で送ります。

すべての断片を集める必要があります。SkipCode32 による不足範囲の確認や比較用として残しています。

### 設定ファイル

QR コードの誤り訂正レベルやバージョンを調整したい場合は、Q4Sender の実行ファイルと同じフォルダーに `conf.yaml` を配置します。詳細は Q4Sender 側の `docs/conf.md` を参照してください。

## QRScanner 側

QRScanner はブラウザ/PWAアプリです。Android などのカメラで Q4Sender の表示を読み取ります。

### 基本操作

1. HTTPS または localhost で `index.html` を開きます。
2. `Mode` を選びます。通常は `Fountain` のままで使います。
3. `読み取り開始` を押します。
4. Q4Sender の QR コード表示にカメラを向けます。
5. `復元完了` が表示されたら完了です。

## 転送モード

### Fountain

標準モードです。Wirehair ベースの `Q4W|...` フレームを使います。

すべての QR コードを順番に読む必要はありません。十分な数の異なるフレームが集まると復元します。読み逃しに強く、通常はこちらを使います。

進捗は目安です。最終的な完了判定は Wirehair による復元と CRC 検証が通った時点です。

### Legacy Q4

従来モードです。`Q4|...` フレームを使います。

すべての断片が必要です。SkipCode32 は Legacy Q4 の不足範囲確認用です。Fountain では基本的に使いません。

## Dual QR

Fountain では、Q4Sender と QRScanner の両方で `Dual QR` が既定で有効です。異なる2枚の QR コードを上下に同時表示して読み取ります。

Q4Sender は現在のフレームと半周先のフレームを上下に表示します。QR コードは縦方向に潰さず、どちらも正方形のまま描画します。

QRScanner は Android Chrome の `BarcodeDetector` を補助経路として使い、カメラ映像内の複数 QR コードを読み取ります。対応していないブラウザでは `Dual QR非対応` と表示され、従来の単一 QR 読み取りはそのまま利用できます。

端末性能、カメラ解像度、距離によっては単一 QR より認識率が落ちる場合があります。その場合は Q4Sender と QRScanner の両方で `Dual QR` を無効にしてください。

実機調整では、次の Q4Sender 設定が速度と認識率のバランスが良好でした。

```yaml
timerInterval: 75
qrSettings:
  version: 25
```

## 保存と共有のルール

Q4Sender はファイルを単一ファイル ZIP に包んで送ります。

QRScanner は復元後、Android で扱いやすい一部の拡張子だけ元ファイルとして保存・共有します。それ以外は ZIP のまま保存・共有します。

元ファイルとして扱う拡張子:

- `.jpg`
- `.jpeg`
- `.png`
- `.gif`
- `.webp`
- `.txt`
- `.pdf`
- `.mp4`
- `.zip`

上記以外の拡張子、たとえば `.cs` や `.js` などのコードファイルは ZIP のまま扱います。Android の共有先アプリによって扱えるファイル種別が違うため、安全側に倒しています。

元ファイルが最初から `.zip` の場合は、中の ZIP を取り出してそのまま保存・共有します。ZIP をさらに ZIP で包み直す挙動にはしていません。

`.txt として保存` は動作確認用の退避機能です。通常は `ファイル保存` を使います。

## 計測表示

最初の有効な QR フレームを読んだ時点から計測を始め、読み取り中から次の情報を表示します。

- モード
- 所要時間
- 復元容量
- 秒あたりの容量

Fountain と Legacy Q4 の比較に使えます。

読み取り中の容量と速度は目安です。復元完了後は、実際に復元した容量で表示します。

## 注意点

- カメラ利用には HTTPS または localhost が必要です。
- PWA として使う場合、更新後に古いキャッシュが残ることがあります。挙動が古い場合は再読み込みやPWAの再起動を試してください。
- Android の共有は受け手アプリの対応ファイル種別に左右されます。迷う拡張子は ZIP のまま扱う方針です。
- 復元完了後のファイル保存はブラウザやOSの制約で確認操作が入ることがあります。

## 開発メモ

- Q4Sender: .NET 8.0 Windows Forms
- QRScanner: static HTML/JavaScript/PWA
- Fountain 生成: `Scanner/libs/wirehair-wasm` と `Sender/Tools/wirehair-encode.mjs`
- プロトコル概要: Q4Sender 側の `docs/q4f-protocol.md`
