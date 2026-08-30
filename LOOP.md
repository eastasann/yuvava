# Navigator — Autonomous Development Loop

## 1. Purpose

このドキュメントは、`SPEC.md` に定義された Navigator VS Code Extension を、自律的な coding agent に継続開発させるための実行ルールを定義する。

この開発では、人間への確認を最小限にする。

Agent は原則として、

- 調査
- 設計判断
- 実装
- テスト
- デバッグ
- 修正
- リファクタリング
- 次の作業の選択

を自律的に行う。

人間は逐次的な実装判断やコードレビューを行わない。

目標は、

> SPEC.md の要求を満たすまで、Agent が自分で判断・実装・検証・修正を繰り返すこと

である。

---

## 2. Source of Truth

開発時の優先順位は以下とする。

1. `SPEC.md`
2. この `LOOP.md`
3. `DECISIONS.md`
4. `PROGRESS.md`
5. Repository 内の既存コード・テスト・設定
6. 使用しているライブラリやプラットフォームの公式ドキュメント
7. 一般的なソフトウェア開発の慣習

矛盾がある場合は、より上位のものを優先する。

### 2.1 Repository is the memory

このプロジェクトの永続メモリは **repository そのもの** である。

| Where | What it holds |
| --- | --- |
| `SPEC.md` | what the product should be |
| `LOOP.md` | how autonomous development should operate |
| `DECISIONS.md` | why the current durable design choices were made |
| `PROGRESS.md` | where development currently stands |
| `git` | implementation history |
| GitHub Issues | 実利用からの観測の受け口（`feedback` ラベル） |

原則：

> **Conversation history is not memory.**

過去のsessionの会話は次のsessionに存在しない。したがって、

- 会話でしか共有されていない事実は、存在しないものとして扱う
- 次のiterationが必要とする情報は、必ず上記のいずれかに書く
- 「前回話した通り」という前提でコードやドキュメントを書かない

このルールが破られた場合、次のAgentは同じ調査・同じ判断・同じ失敗を繰り返す。
それを防ぐことが §24 Context Recovery と §25 Loop Handoff の目的である。

### 2.2 Feedback は Issue で受け、結論をrepositoryに残す

実利用からの観測は GitHub Issues（`feedback` ラベル）で受け取る。

    Issue      = 生の観測の受け口（一時的・編集可能・削除可能）
    Repository = そこから得た結論の記憶

Issueをrepositoryの外に置くのは §2.1 の例外ではない。次のAgentが必要とするのは
個々の報告そのものではなく、そこから導かれた結論だからである。Issueに対応したら、

- durable な判断 → `DECISIONS.md`
- 未解決の課題 → `PROGRESS.md`
- 実装上の注意 → コード中のコメント

に残した上でIssueを閉じる。閉じたIssueが失われても、結論はrepositoryに残る。

feedbackはAgentの推測より優先する。ただし `SPEC.md` を上書きはしない。矛盾する
場合は §8.4 の escalation 対象になりうる。

> **このrepositoryは public である。**

Issueにも、repositoryのどのファイルにも、レビュー対象になった実際のユーザー
コードを貼らない。業務コードや他プロジェクトの断片が公開され、git履歴からは
取り消せない。残すのはコードではなくパターンである。

    ✗ src/billing/invoice.ts:142 で amount が null と指摘された
      該当コード: const total = invoice.amount * rate;

    ✓ 誤検知: 呼び出し元でガード済みの値に null 指摘が出る。
      関数境界をまたいだガードを追えていない。

後者は実コードを含まないのに `src/core/prompt.ts` のどこを直すべきかを特定できる。
再現に最小限のコードが要る場合は、書き直した例を使う。

---

## 3. Core Loop

Agent は以下のループを繰り返す。

    Context Recovery   ← §24 / session開始時に必須
      ↓
    Inspect
      ↓
    Decide
      ↓
    Implement
      ↓
    Verify
      ↓
    Evaluate
      ↓
    ┌───────────────┐
    │               │
    PASS          NOT PASS
    │               │
    ↓               ↓
    Loop Handoff   Diagnose
    ← §25 / 必須      ↓
      ↓            Retry
    Stop

各iterationで、必ず現在の状態を確認してから次の作業を決定する。

両端の2つは省略できない。

- **開始時**: §24 Context Recovery を実行してから最初の判断を行う
- **終了時**: §25 Loop Handoff を完了してから停止する

途中で中断される場合も、可能な限り §25 を実行してから止まる。

---

## 4. Inspect

session開始時の復元は §24 Context Recovery に従う（必須）。
以下は、そのあとの各iterationで必要に応じて確認するもの。

- `SPEC.md`
- `LOOP.md`
- repository structure
- current implementation
- current git diff
- existing tests
- build configuration
- lint configuration
- package configuration
- previous failures
- previous decisions
- relevant official documentation

毎回すべてを読み直す必要はない。

現在の作業を合理的に判断するために必要な情報だけ取得する。

---

## 5. Decide

現在の状態から、次に行うべき最も重要な作業を自分で決定する。

人間に、

- 次は何を実装するべきか
- どのAPIを使うべきか
- どの設計にするべきか
- どのライブラリを使うべきか
- ファイルをどう分割するべきか
- UIをどう構成するべきか

などを原則として質問しない。

判断が必要なこと自体は停止理由ではない。

---

## 6. Decision Policy

判断が必要になった場合、以下の順序で決定する。

### 6.1 SPECを確認する

まず `SPEC.md` に答えがないか確認する。

### 6.2 Existing precedentを探す

既存コードに同様の問題を解決している箇所があれば、その慣習を優先する。

### 6.3 Official documentationを確認する

VS Code APIや利用ライブラリについて不明点がある場合、推測だけで進めず、必要に応じて公式ドキュメントを確認する。

### 6.4 Simplest reasonable solutionを選ぶ

複数の合理的な選択肢がある場合、

> 最も単純で、理解しやすく、変更しやすいもの

を優先する。

### 6.5 Reversible decisionを優先する

後から容易に変更できる判断については、完璧な確信を求めない。

合理的な選択肢を選んで作業を継続する。

### 6.6 Avoid speculative architecture

将来必要になるかもしれないという理由だけで、

- abstraction
- framework
- dependency
- extensibility layer
- configuration system

を追加しない。

現在のSPECを満たす最小限の設計を優先する。

---

## 7. Do Not Ask by Default

以下のような質問を人間にしない。

    Which architecture would you prefer?

    Should I use approach A or B?

    Would you like me to add tests?

    Should this be configurable?

    Should I continue?

    Do you want me to fix this error?

    Which naming convention should I use?

代わりに、自分で調査して合理的な判断を行う。

原則：

> **If the decision is reversible, decide and continue.**

---

## 8. Escalation

人間への確認は例外とする。

以下の場合のみ停止・escalationを許可する。

### 8.1 Irreversible external action

例：

- production deployment
- production data modification
- external serviceへの破壊的操作
- public release
- irreversible migration

### 8.2 Credentials are required

必要なcredentialやsecretが存在せず、自力では取得できない場合。

### 8.3 Requirements are logically contradictory

`SPEC.md` の複数の必須要件が論理的に同時達成できない場合。

単に実装方法が分からないことは escalation 理由ではない。

### 8.4 External decision with significant product meaning

技術判断ではなく、選択によってプロダクトの根本的な意味や目的が変わる場合。

ただし、SPECから合理的に推測できる場合は自分で判断する。

---

## 9. Implementation

Agent は必要なコードを自由に作成・変更できる。

この制限は、Navigatorという完成プロダクト自身の制限とは区別すること。

Navigator はユーザーのimplementation codeを書いてはいけないが、

> Navigatorを開発しているAgent

はNavigator自身のsource codeを実装してよい。

この2つを混同しないこと。

---

## 10. Small Iterations

可能な限り、一度に巨大な変更を行わない。

推奨単位：

    One capability
        ↓
    Implement
        ↓
    Verify
        ↓
    Continue

例えば、

    Extension activation
        ↓
    Verify
        ↓
    Review command
        ↓
    Verify
        ↓
    Git diff retrieval
        ↓
    Verify
        ↓
    Review provider
        ↓
    Verify
        ↓
    Diagnostics
        ↓
    Verify

のように進める。

ただし、機械的に細分化しすぎて進行を妨げない。

---

## 11. Verification

Agent自身の、

> "実装できたと思う"

という判断だけで完成扱いにしない。

可能な限り機械的なverificationを使用する。

最低限、repositoryに存在する以下のようなverificationを実行する。

- compile
- typecheck
- lint
- unit tests
- integration tests
- extension tests
- package/build

実際のコマンドはrepositoryから判断する。

---

## 12. Tests Are Part of Implementation

必要なテストが存在しない場合、Agent自身で追加する。

特に以下はテスト対象とする。

- core business logic
- review result parsing
- diagnostic conversion
- git diff handling
- malformed AI response
- empty review result
- failure handling
- source-code modification invariant

テストを書くかどうかを人間に質問しない。

---

## 13. Product Invariant Verification

通常のテストだけでなく、Navigator固有のinvariantを検証する。

最重要invariant：

> Navigator must never modify user implementation code automatically.

可能であれば、この制約を自動テストする。

例えばNavigatorが、

- source fileを書き換えない
- automatic patchを適用しない
- Quick Fixを生成しない
- implementation completionを実行しない

ことを検証する。

Prompt上の禁止だけに依存しない。

---

## 14. AI Output Verification

Navigator内部でAIを利用する場合、AI outputを無条件に信頼しない。

可能な限りstructured outputを使用する。

例：

    {
      "issues": [
        {
          "file": "src/example.ts",
          "line": 42,
          "severity": "warning",
          "message": "Potential null case is not handled."
        }
      ]
    }

以下を検証する。

- schema validity
- required fields
- valid file
- valid line
- supported severity
- empty result
- malformed result
- unexpected output

AI responseが壊れていても、extension全体が壊れないこと。

---

## 15. Failure Handling

verificationが失敗した場合、すぐ人間に報告して停止しない。

以下を行う。

    Failure
      ↓
    Read error
      ↓
    Identify likely cause
      ↓
    Inspect relevant code/docs
      ↓
    Fix
      ↓
    Verify again

Compiler error、test failure、lint failureは通常の開発loopの一部として扱う。

---

## 16. Repeated Failure

同じ失敗を繰り返している場合、同じ修正を機械的に繰り返さない。

以下を再評価する。

- original assumption
- architecture
- API understanding
- test expectation
- documentation
- implementation approach

必要であれば一度変更を戻し、別のアプローチを試す。

---

## 17. Research

不明なAPIや挙動については、必要に応じて調査する。

優先する情報源：

1. Official documentation
2. Official source / repository
3. Existing repository code
4. Well-established technical references

ランダムなblogやforumの情報だけを根拠に重要な設計判断を行わない。

ただし、調査そのものを目的化しない。

必要な情報が得られたら実装へ戻る。

---

## 18. Dependency Policy

新しいdependencyは必要な場合のみ追加する。

追加前に、

- platform標準機能で実現できないか
- 既存dependencyで実現できないか
- dependency追加による複雑さに見合うか

を判断する。

小さな処理のためだけに大きなdependencyを追加しない。

dependency追加が合理的で可逆的であれば、人間への確認は不要。

---

## 19. Scope Control

`SPEC.md` に存在しない機能を、面白そうだからという理由で追加しない。

特に以下を勝手に追加しない。

- autonomous coding
- code generation
- auto fix
- chat-centric UI
- large configuration system
- unnecessary dashboards
- telemetry
- account systems
- cloud infrastructure

まずMVPを完成させる。

---

## 20. MVP First

Optional requirementsよりRequired requirementsを優先する。

優先順位：

    Correctness
        ↓
    Required MVP
        ↓
    Tests
        ↓
    Robustness
        ↓
    Optional features

Optional featureの実装によってMVP完成が遅れる場合、Optional featureは後回しにする。

---

## 21. Refactoring

必要なrefactoringは自律的に行ってよい。

ただし、

> refactoring自体を目的にしない。

以下の場合は合理的。

- duplicationが実装を難しくしている
- testabilityを阻害している
- responsibilityが明確に混在している
- upcoming required featureに必要
- correctness riskがある

単に「より美しい」だけのrefactoringは避ける。

---

## 22. Decision Log (DECISIONS.md)

`DECISIONS.md` は **why** を保持する。将来のAgentが同じ判断をやり直さないための
ファイルであり、実装の要約ではない。

durable な判断を行った場合、`DECISIONS.md` への記録は **必須** である（§25）。

### 22.1 記録するもの

- architecture choice（層の分け方、依存の向き、テスト可能性のための境界）
- product invariant をどう構造的に守っているか
- provider / API / structured output の設計
- git integration の方針
- diagnostics mapping strategy
- dependency の採否
- 「なぜ X をやらなかったか」— 後から誰かが再提案しそうなもの

### 22.2 記録しないもの

- 変数名、ファイル分割、フォーマットなどの些末な選択
- コードを読めば分かること（what）
- 一度きりのバグ修正
- 推測でしかない理由付け

> 根拠のない理由を書かない。実装・`SPEC.md`・repository history から
> 合理的に裏付けられる判断だけを記録する。

### 22.3 形式

    ## Decision: Use VS Code Diagnostics for review output

    Reason:
    Navigator should behave more like a linter than a chat interface.

    Alternatives considered:
    - Webview
    - Output panel

    Why this choice:
    Diagnostics integrates naturally with the editor and Problems panel.

必要に応じて `Consequence:` / `Escape hatch:` / `When to revisit:` を足す。

判断が後から覆された場合、古い項目を黙って消さない。書き換えた上で、
なぜ変わったかを残す。

---

## 23. Progress Tracking (PROGRESS.md)

`PROGRESS.md` は **where development currently stands** を保持する。

> PROGRESS.md is current working state, not a historical diary.

過去に何をしたかの記録は `git log` の仕事である。`PROGRESS.md` には
「いま何が終わっていて、次に何が必要か」だけを書く。完了した項目の履歴が
膨らんできたら削る。

### 23.1 必須セクション

    # Progress

    ## Status              現在地を数行で。次のAgentが最初に読む部分
    ## Verification        コマンドと、最後に実行した実際の結果
    ## Done                完了した capability（SPEC の要件と対応付ける）
    ## Remaining           未着手・未解決の作業と、その理由
    ## Known problems      既知の欠陥・ギャップ・信用してはいけない箇所
    ## Notes for the next loop   次のsessionが真っ先に知るべきこと

### 23.2 ルール

- 「たぶん動く」と書かない。検証したか、していないかを書く
- 意図的にやらないことは "Remaining" ではなく理由と共に明示する
- Known problems を空にするために問題を消さない
- 実際にコマンドを実行して結果を書く（§25.2）

---

## 24. Context Recovery

**すべてのsessionの開始時に必須。**

過去のconversation contextが存在することを前提にしない。
新しいsessionは、次の入力だけで作業を再開できなければならない。

    Read SPEC.md and LOOP.md.
    Continue according to LOOP.md.

### 24.1 手順

以下の順で現在状態を復元する。

1. `SPEC.md` — 何を作るのか。ここが最上位の source of truth
2. `LOOP.md` — どう進めるのか（このファイル）
3. `DECISIONS.md` — なぜ今の設計なのか。**アーキテクチャを変える提案の前に必読**
4. `PROGRESS.md` — どこまで進んでいるか、既知の問題は何か
5. `git status` / `git diff` — 未コミットの変更が残っていないか
6. `git log --oneline -20` — 直近で何が起きたか
7. open な GitHub Issues — 特に `feedback` ラベル（§2.2）
8. 未解決のレビュー指摘
9. 関連するテスト — 何が保証されていて、何が保証されていないか

### 24.2 復元後に確認すること

- 作業ツリーは clean か。clean でない場合、その変更は誰のものか
- `PROGRESS.md` の Verification は、いま実行しても同じ結果になるか
  （疑わしい場合は実行して確かめる。推測で先に進まない）
- `PROGRESS.md` の Known problems に、今回触る領域のものはないか
- `DECISIONS.md` に、これからやろうとしていることを既に否定した項目はないか

### 24.3 矛盾を見つけた場合

ドキュメントと実装が食い違っている場合、実装が正しいとは限らない。

1. `SPEC.md` を基準に、どちらが正しいかを判断する
2. ドキュメントが古いなら、そのiterationで直す
3. 実装が仕様から外れているなら、それは修正すべき欠陥である
4. どちらとも言えない場合は `PROGRESS.md` の Known problems に記録する

黙って放置しない。次のAgentが同じ矛盾に躓く。

---

## 25. Loop Handoff

**すべてのloopの終了前に必須。**

Loop の成果物はコードだけではない。
**次の完全にまっさらなAgent sessionが継続できる repository state** が成果物である。

コードが動いていても handoff が終わっていなければ、そのloopは完了していない。

### 25.1 Handoff checklist

停止する前に、以下をすべて満たす。

- [ ] `PROGRESS.md` を現在の状態に更新した
      （Status / Done / Remaining / Known problems / Notes for the next loop）
- [ ] durable な判断をしたなら `DECISIONS.md` に記録した（§22）
      — していないなら「今回は durable な判断はなかった」と言えること
- [ ] 未解決の作業を記録した
      — 途中で止めたもの、意図的に見送ったもの、その理由
- [ ] verification を実際に実行し、その結果を `PROGRESS.md` に書いた（§25.2）
- [ ] 新しく分かった制約・落とし穴・信用できない箇所を Known problems に書いた
- [ ] `SPEC.md` / `LOOP.md` / `AGENTS.md` と実装の食い違いを直したか、記録した
- [ ] 変更を commit した。作業ツリーに説明のない差分を残していない
- [ ] `git log` のメッセージだけで「何が変わったか」が追える

### 25.2 Verification results は実測値

`PROGRESS.md` の Verification セクションには、**実際に実行した結果**を書く。

    npm run lint      # 実行して exit code を確認
    npm run compile
    npm test
    npm run package

前回の値をコピーしない。テスト数が変わっていれば、それ自体が情報である。
実行できなかった場合は、実行できなかったと書く。

### 25.3 会話で終わらせない

このloopの中でしか存在しない情報を、会話の中に置き去りにしない。

次のAgentが知る必要があるなら、それは repository の中になければならない。

- 「APIのこの挙動に注意」→ コードのコメント、または Known problems
- 「この設計にしたのは〜だから」→ `DECISIONS.md`
- 「あと残っているのは〜」→ `PROGRESS.md`
- 「このテストは環境依存」→ Known problems

### 25.4 Git

可能な限りgitを安全網として利用する。

大きなmilestoneが安定した場合、commit可能な状態を維持する。

ただし、既存repositoryのgit policyがある場合はそれを優先する。

意図しない既存変更を勝手に削除しない。

Agent自身が作成していない変更が存在する場合、それを壊さないよう注意する。

Handoff時点で作業ツリーは clean であることが望ましい。未コミットの変更を
残して止まる場合は、その理由を `PROGRESS.md` に書く。

---

## 26. Completion Criteria

以下をすべて満たした場合のみMVP完成と判断する。

### Functional

- VS Code extensionとして起動できる
- `Navigator: Review Current Changes` が利用できる
- git diffを取得できる
- review処理を実行できる
- structured resultを処理できる
- issuesをDiagnosticsとして表示できる
- no issueの場合は不要な表示をしない

### Safety

- user source codeを自動変更しない
- automatic fixを提供しない
- replacement implementationをNavigatorが生成しない設計になっている

### Reliability

- malformed review responseを安全に処理する
- AI failureでextensionが壊れない
- git failureを安全に処理する
- empty diffを安全に処理する

### Quality

- compile/typecheck passes
- lint passes
- tests pass
- package/build succeeds if applicable

### Specification

- `SPEC.md` のRequired MVP requirementsを満たしている

### Handoff

- §25 Loop Handoff checklist をすべて満たしている
- `PROGRESS.md` の Verification が実測値である
- 新しいsessionが `SPEC.md` と `LOOP.md` だけで作業を再開できる

---

## 27. Definition of Done

Agentは単に、

> code compiles

だけで完成と判断しない。

Definition of Done:

    SPEC satisfied
        AND
    tests pass
        AND
    build/typecheck pass
        AND
    core invariants verified
        AND
    no known blocking defects
        AND
    Loop Handoff complete (§25)

この条件を満たした場合のみloopを終了する。

最後の条件は他と同じ重さを持つ。次のAgentが継続できない状態で止まることは、
テストが落ちている状態で止まることと同じである。

---

## 28. Final Evaluation

完成候補になったら、実装者視点から一度離れて全体を評価する。

以下を確認する。

- SPECに対する要求漏れはないか
- 実装したが実際には動かない機能はないか
- unnecessary complexityはないか
- Navigatorがコード生成ツールへ変質していないか
- user source codeを書き換える経路がないか
- failure pathが安全か
- testが実装詳細だけを確認していないか
- `PROGRESS.md` / `DECISIONS.md` を読むだけで、この状態を引き継げるか
- このsessionの会話にしか存在しない重要な情報が残っていないか

問題があれば修正して再度verificationする。

---

## 29. Stop Conditions

Loopを終了してよいのは以下の場合。

いずれの場合も、停止する前に §25 Loop Handoff を実行する。
理由が何であれ、次のAgentは repository から状況を理解できなければならない。

### Success

Definition of Doneを満たした。

### Escalation

自律的に解決できない、明確なescalation conditionに到達した。

何をescalationしたのか、何を待っているのかを `PROGRESS.md` に書いてから止まる。

### Environment Blocker

必要なcredential、runtime、external serviceなどが存在せず、合理的なmock/stubでも進められない。

何が足りなかったのかを Known problems に書いてから止まる。次のsessionの
環境では解決しているかもしれない。

単なる、

- uncertainty
- implementation difficulty
- failing tests
- unfamiliar API
- architecture choice

は停止理由ではない。

---

## 30. Core Behavioral Rule

このLoopで最も重要なルール：

> **Do not stop because a decision is required. Make the decision.**

判断に迷った場合は、

1. SPECを見る
2. repositoryを見る
3. official docsを見る
4. simplest reasonable solutionを選ぶ
5. 実装する
6. 検証する
7. 間違っていたら修正する

完璧な判断を事前に求めない。

---

## 31. Engineering Principle

Agentの目標は、

> 一度で正しいコードを書くこと

ではない。

目標は、

> **自分で判断し、実装し、結果を観測し、間違っていれば修正できるloopを維持すること**

である。

判断の正確さだけに依存せず、

    Decision
      ↓
    Implementation
      ↓
    Verification
      ↓
    Feedback
      ↓
    Correction

によって最終的な品質を得る。

---

## 32. Final Instruction

`SPEC.md` のNavigatorを完成させること。

人間への質問を前提にしない。

必要な判断は自分で行う。

必要な情報は自分で調査する。

必要なテストは自分で作る。

失敗したら原因を調べて修正する。

一つのアプローチに固執しない。

MVPを優先する。

Navigatorの「Human is the Driver」という思想を壊さない。

そして、

> **SPECを満たし、verificationが通り、core invariantが守られている状態**

になるまでloopを継続する。

そして停止する前に、§25 Loop Handoff を完了する。

次のsessionは、この入力だけで再開する。

    Read SPEC.md and LOOP.md.
    Continue according to LOOP.md.

それで足りる状態にしておくことが、このloopの最後の仕事である。
