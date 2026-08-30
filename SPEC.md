# Navigator — VS Code AI Pair Programming Assistant

## 1. 概要

Navigator は、AIにコードを書かせるための VS Code 拡張ではない。

開発者自身がコードを書き、考え、調べ、デバッグすることを維持しながら、AIを人間のペアプログラミングにおける **Navigator** として利用するための開発支援ツールである。

目指す体験は、

> AIがコードを書いてくれる環境

ではなく、

> 自分がコードを書いている横で、優秀なエンジニアが黙って見ている環境

である。

Navigator は開発者の代わりに問題を解くのではなく、開発者自身が問題を発見・理解・解決することを支援する。

---

## 2. 背景

AI coding agent を利用すると、開発者は非常に高い生産性を得られる一方で、以下の工程を経験する機会が減る。

- 自分で設計する
- 自分でコードを書く
- APIや構文を思い出す
- ドキュメントを読む
- ライブラリの周辺機能を探索する
- Compiler / Linter / Runtime error を読む
- 原因を推測する
- 修正方法を考える
- 試行錯誤する

特に、従来は以下のようなループそのものが技術理解につながっていた。

    ドキュメントを読む
    ↓
    コードを書く
    ↓
    失敗する
    ↓
    エラーを読む
    ↓
    ドキュメントへ戻る
    ↓
    理解する

AI coding agent を中心にすると、このループが以下のように変化する。

    AIに要求を書く
    ↓
    AIが調査
    ↓
    AIが実装
    ↓
    AIが検証
    ↓
    AIが修正
    ↓
    完成

これによって失われる可能性があるのは、単なるタイピング能力ではない。

ドキュメントを眺めたり、APIを探したり、エラーを調べたりする過程では、その問題に直接必要ではない周辺知識にも触れる。

その結果、

- ライブラリには何が存在するのか
- API同士がどう関連しているのか
- どのような設計思想を持っているのか
- どこを調べれば答えが見つかるのか
- どのような失敗が起こりやすいのか

といった、技術についての「頭の中の地図」が形成される。

AIが調査・実装・修正をすべて代行すると、この地図を形成する機会まで失われやすい。

Navigator はこの問題に対して、

**AIを排除するのではなく、AIの役割を意図的に制限する**

というアプローチを取る。

---

## 3. ゴール

Navigator の最優先ゴールは、

> **開発者自身のコーディング能力・デバッグ能力・技術理解を維持または回復すること**

である。

生産性の最大化は最優先ではない。

特に以下の能力を開発者側に残す。

- 設計する能力
- 自分でコードを書く能力
- APIや構文を思い出す能力
- 必要な情報を探す能力
- ドキュメントを読む能力
- ライブラリ全体を探索する能力
- エラーを読む能力
- 原因を推測する能力
- デバッグする能力
- 修正方法を考える能力
- リファクタリングを判断する能力
- 技術選択を行う能力

Navigator はこれらをAIに代行させるのではなく、必要な場面だけ補助する。

---

## 4. 基本思想

### 4.1 Human is the Driver

コードを書く主体は常に人間である。

    Human = Driver
    AI    = Navigator

Human が担当する。

- 設計
- Implementation
- Debugging
- Fix
- Refactoring
- 技術判断
- API探索
- Documentation reading

Navigator が担当する。

- Observation
- Review
- Risk detection
- Edge-case detection
- Documentation navigation
- Minimal hints
- Recall assistance

### 4.2 AIは原則としてコードを書かない

Navigator は以下を原則として行わない。

- 関数の実装
- 未完成コードの補完
- ファイル全体の生成
- replacement code の提示
- 自動リファクタリング
- 自動修正
- Quick Fix によるコード変更
- 次に書くコードの大量予測
- 「より綺麗」という理由だけの書き換え
- 開発者の代わりに問題を解決すること

AIによるコード生成は明示的に要求された場合を除き禁止する。

### 4.3 AIは答えではなくフィードバックを提供する

Navigator の基本的な出力は `Answer` ではなく `Observation` である。

例えば、

    ⚠ items が undefined のケースを考慮していません。

までは伝える。

しかし、具体的な修正コードは原則として提示しない。

問題の存在を知らせるところまでをNavigatorが担当し、修正方法を考える工程はHumanに残す。

### 4.4 AIは必要なときだけ介入する

Navigator は常にコメントする必要はない。

問題がなければ黙っている。

    Human writes code
           ↓
    Navigator observes
           ↓
    No meaningful issue
           ↓
    Silence

Navigator の価値は発言量ではなく、必要なときに高いsignalを提供できることにある。

---

## 5. 理想的な利用体験

通常時は以下のようになる。

    Human
      ↓
    考える
      ↓
    コードを書く
      ↓
    LSP / Compiler / Linter
      ↓
    Navigator observes
      ↓
    問題なし
      ↓
    何もしない

問題を発見した場合のみ、

    Human writes code
           ↓
    Navigator reviews
           ↓
    Potential problem
           ↓
    ⚠ Short observation
           ↓
    Human investigates
           ↓
    Human fixes

となる。

Navigator はChatbotというより、

**少し賢い Compiler / Linter / Pair Programmer**

として振る舞う。

---

## 6. Review

Navigator は現在の変更差分をレビューできること。

主なレビュー対象は以下。

- correctness bugs
- missed edge cases
- null / undefined handling
- error handling
- concurrency issues
- security risks
- performance problems
- unnecessary complexity
- confusing design
- unreachable code
- unintended behavior
- regression risks

レビューは原則として問題点のみを提示する。

### 6.1 良いレビュー

    ⚠ items が undefined のケースを考慮していません。

    ⚠ この分岐では foo が null の可能性があります。

    ⚠ 入力サイズに対してこの処理は O(n²) になります。

    ⚠ この関数はデータ取得と変換の2つの責務を持っています。

### 6.2 避けるレビュー

以下のように修正コードまで提示しない。

    こう書き換えると良いです:
    [replacement implementation]

Navigator は問題を発見する。

**解決はHumanに残す。**

---

## 7. Silence by Default

Navigator は「何かコメントすること」を目的にしない。

問題がなければ何も表示しない。

    No meaningful issue
            ↓
          Silence

以下のような低価値な指摘は避ける。

- 好みの問題
- stylistic preference
- 別の書き方も可能というだけの指摘
- 不必要な抽象化提案
- speculative optimization
- 「よりエレガント」という理由だけの変更提案
- CompilerやLinterから既に得られる情報の単純な繰り返し

目標は、

> **signal-to-noise ratio を高く保つこと**

である。

---

## 8. Progressive Hints

Navigator は答えを即座に提示しない。

開発者が助けを求めた場合も、情報を段階的に開示する。

    Level 0: Issue only
        ↓
    Level 1: Small hint
        ↓
    Level 2: More specific hint
        ↓
    Level 3: Conceptual explanation

### Level 0

    ⚠ この条件分岐には未処理ケースがあります。

### Level 1

    foo が存在しない場合を考えてください。

### Level 2

    API responseでは foo は optional です。

### Level 3

    このAPIでは対象データが存在しない場合、
    foo 自体がレスポンスから省略される可能性があります。

原則として、Level 3でも完成コードは提示しない。

目的は、

    Hint
      ↓
    Human thinks
      ↓
    Human solves

というループを維持することである。

---

## 9. Recall Assistance

構文、API名、型、標準ライブラリなどを忘れた場合、Navigator は「答えを作る」のではなく、記憶を呼び戻すことを支援する。

情報は段階的に提示する。

    Name
      ↓
    Signature
      ↓
    Concept
      ↓
    Documentation

例えば `Array.prototype.reduce` を思い出せない場合：

### Name

    Array.prototype.reduce

### Signature

    reduce(callbackFn, initialValue?)

### Concept

    配列を順番に処理し、一つの値へ畳み込みます。

それ以上必要なら公式ドキュメントへ誘導する。

目的は、AIからコピペ可能な答えを受け取ることではなく、

**自分の記憶から知識を取り出すこと**

である。

---

## 10. Documentation Navigation

Navigator の重要な役割の一つは、

> **ドキュメントを読む代わりになることではなく、読むべき場所まで案内すること**

である。

開発者がAPI、ライブラリ、フレームワークの挙動について質問した場合、可能な限り即答するのではなく、関連する公式ドキュメントを提示する。

### 10.1 Docs Mode

Navigator は以下のような情報を提示できる。

    Relevant documentation

    React
    → Synchronizing with Effects
    → Specifying reactive dependencies

または、

    Relevant API

    URLSearchParams

    Suggested section:
    set()

可能であれば以下まで絞り込む。

- 公式ドキュメント
- relevant page
- relevant section
- relevant API

### 10.2 Documentation Discovery

単に一点の答えを提示するだけでなく、必要に応じて周辺ドキュメントも発見できるようにする。

ただし大量のリンクを提示しない。

目的は、

    AI answer

ではなく、

    Human
      ↓
    Relevant docs
      ↓
    Explore
      ↓
    Understand
      ↓
    Implement

という学習ループを維持することである。

### 10.3 Serendipitous Learning

ドキュメントを読む価値は、現在の問題に対する答えだけではない。

開発者がドキュメントを眺めることで、

- 隣接するAPI
- 関連概念
- 設計思想
- 制約
- 非推奨機能
- より適切な抽象化

などを偶然発見できる。

Navigator は、この偶発的な学習を可能な限り奪わない。

そのため、AIがドキュメント内容をすべて要約してしまうのではなく、開発者自身が公式ドキュメントを開く余地を残す。

---

## 11. Traditional Development Tools

Navigator は従来型の開発支援を置き換えない。

以下は積極的に利用する。

- IntelliSense
- LSP
- Compiler
- Type Checker
- Linter
- Formatter
- Go to Definition
- Find References
- Debugger
- Test Runner

基本構成：

    VS Code

    Human
     │
     ├── IntelliSense
     ├── LSP
     ├── Type Checker
     ├── Compiler
     ├── Linter
     │
     └── Navigator
           ├── Reviewer
           ├── Observer
           ├── Memory Jogger
           └── Documentation Navigator

Navigator はCompilerやLinterの代わりではない。

既存の静的解析で検出できる問題については、可能な限り既存ツールを優先する。

---

## 12. UI

Navigator は可能な限り既存の VS Code UI に溶け込む。

独自の大きなChat UIを中心にしない。

優先するUI：

- Diagnostics
- Problems panel
- Hover
- Status Bar
- Commands
- Small contextual actions

### 12.1 Diagnostics

レビュー結果は可能であれば Diagnostics として表示する。

例えば、

    const count = items.length;
                  ~~~~~
                  ⚠ items が存在しないケースを確認してください。

のような体験を提供する。

### 12.2 Status Bar

状態表示は最小限にする。

例：

    Navigator: idle
    Navigator: reviewing
    Navigator: 2 observations

問題がない場合、可能な限り存在感を出さない。

### 12.3 Chat UI

Chat UIは中心的なインターフェースにしない。

Navigatorとの基本的な関係は、

    Human asks AI
        ↓
    AI answers

ではなく、

    Human works
        ↓
    Navigator observes
        ↓
    Necessary feedback only

である。

---

## 13. Review Trigger

初期バージョンではレビューを手動で開始する。

例：

    Navigator: Review Current Changes

レビュー対象は主に現在の `git diff` とする。

初期運用：

    Human writes code
        ↓
    Function / feature completed
        ↓
    Review command
        ↓
    Navigator reviews diff
        ↓
    Human fixes issues
        ↓
    Continue

十分有用であることが確認できた場合のみ、自動レビューを検討する。

---

## 14. Automatic Review

将来的には以下をtriggerとしてレビューできるようにする。

- Save
- Git commit
- Explicit command
- Idle period

ただし、頻繁なAI介入によって思考を妨害しないこと。

自動レビューでは debounce / cooldown を設ける。

Navigator は、

> 常に話しかけてくるペアプログラマー

ではなく、

> 必要なときだけ口を開くペアプログラマー

である。

---

## 15. Review Intensity

レビュー強度を変更できるようにしてもよい。

### Silent

明確な correctness bug のみ。

### Normal

- correctness
- edge cases
- risky design

### Strict

- correctness
- edge cases
- security
- performance
- complexity
- maintainability

どのモードでもコード生成は禁止する。

---

## 16. Hard Safety Invariant

Navigator の最重要invariant：

> **Navigator must never modify user implementation code automatically.**

拡張機能自身がソースコードを書き換えないこと。

原則として以下のような機能を実装しない。

- Apply Fix
- Apply Patch
- Generate Function
- Complete Implementation
- Auto Refactor
- Accept AI Suggestion

AI outputは以下に限定する。

- Observation
- Hint
- Explanation
- Documentation

この制約は単なるPrompt上の指示だけに依存しないことが望ましい。

可能であれば、Navigator自体がユーザーのsource codeを書き換える能力を持たない設計とする。

---

## 17. AI Interaction Policy

Navigator 内部で利用するAIには以下の役割を与える。

    The human is always the driver.

    You are the navigator.

    Your job is to observe the developer's work and point out
    meaningful problems.

    Do not write implementation code.

    Do not provide replacement code unless explicitly requested.

    Do not complete unfinished functions.

    Do not suggest changes merely because they are stylistically
    cleaner or more elegant.

    Prefer silence over low-confidence feedback.

    When you find a problem:
    - explain what is wrong
    - explain why it matters
    - give the developer room to solve it

    When the developer asks about an API or syntax:
    - prefer recall assistance
    - then signatures
    - then conceptual explanation
    - then relevant official documentation

    Do not remove the developer from the problem-solving process.

---

## 18. Non-Goals

Navigator は以下を目的としない。

### 18.1 Productivity maximization

可能な限り早くコードを完成させることは最優先ではない。

### 18.2 Autonomous coding

Issueを渡して完成したPRを返すagentではない。

### 18.3 AI autocomplete

次の数十行を予測して生成するツールではない。

### 18.4 Documentation replacement

公式ドキュメントを読む必要を完全になくすものではない。

### 18.5 AI teacher

常に説明や講義を行う教育ツールでもない。

### 18.6 AI search replacement

質問すればすべて答えてくれる検索エンジンを目指さない。

Navigator はあくまで、

**Human-driven developmentを維持するための補助者**

である。

---

## 19. MVP

最初のバージョンでは以下のみ実装する。

### Required

- VS Code extensionとして動作する
- `Navigator: Review Current Changes` command
- git diffを取得できる
- AIにdiffをレビューさせる
- structured review resultを受け取る
- 問題をDiagnosticsとして表示する
- 問題がなければ何も表示しない
- AIはimplementation codeを生成しない
- extensionはuser source codeを変更しない

### Optional

- Progressive hints
- Documentation navigation
- Review intensity
- Status Bar
- Automatic review
- Review history
- Recall assistance

Optional機能はMVP完成後に検討する。

---

## 20. Acceptance Criteria

MVPは最低限以下を満たす。

### Review

- git diffをレビューできる
- file / line に対応した指摘を表示できる
- correctness issueを指摘できる
- edge caseを指摘できる

### Silence

- meaningful issueがない場合はDiagnosticsを生成しない
- stylistic preferenceだけの指摘を避ける

### No Code Generation

- replacement implementationを表示しない
- incomplete functionを完成させない
- automatic fixを提供しない

### No Code Modification

Navigator自身がuser source codeを変更しない。

### Failure

AI reviewが失敗した場合も、

- user codeを変更しない
- development workflowをblockしない
- failureを簡潔に通知する

こと。

---

## 21. 将来的な方向性

MVPが有効であれば、以下を検討する。

### 21.1 Progressive Assistance

    Observation
        ↓
    Hint
        ↓
    Detailed Hint
        ↓
    Explanation
        ↓
    Docs

### 21.2 Documentation Navigator

現在のコードやエラーから、読むべき公式ドキュメントを提示する。

### 21.3 Context-aware Review

現在のファイルだけでなく、

- related types
- tests
- call sites
- git history
- documentation

などを必要に応じて参照する。

### 21.4 Learning-aware Behavior

開発者が頻繁に尋ねるAPIについて、すぐ答えるのではなく徐々にヒントを減らす。

目的はNavigatorへの依存を増やすことではなく、時間とともにNavigatorを必要としなくなることである。

### 21.5 Passive Navigator

開発者の作業を邪魔せず、必要な場合だけ静かにDiagnosticsを追加する。

### 21.6 Documentation Exploration

現在触っているライブラリについて、答えそのものではなく、

    You may want to explore:
    - API A
    - API B
    - Concept C

程度の探索候補を提示する。

ただし、開発者の集中を妨げないよう頻度は低くする。

---

## 22. Product Principle

Navigator の設計判断に迷った場合は、以下の問いを使う。

> **この機能は、開発者自身が考える機会を増やすか、それとも奪うか？**

奪うのであれば、原則として実装しない。

もう一つの判断基準は、

> **この機能は、開発者が技術についての「頭の中の地図」を作る助けになるか？**

である。

Navigator はAIの能力を最大限ユーザーに与えるためのツールではない。

AIができることを意図的に制限することで、

**人間が考え、調べ、理解し、コードを書く余地を守るためのツール**

である。

---

## 23. North Star

理想的な状態では、開発者はNavigatorを使っていることをほとんど意識しない。

普段は自分でコードを書く。

分からなければ考える。

必要ならドキュメントを読む。

APIを忘れたら、まず思い出そうとする。

エラーが出れば自分で読む。

原因を推測する。

試してみる。

失敗する。

また考える。

その過程でライブラリや言語について理解を深める。

そして、本当に見落としている問題があるときだけ、

    ⚠ Navigator

が静かに現れる。

目指すのは、

> **AIに依存しないために、AIを使う。**

という開発環境である。
