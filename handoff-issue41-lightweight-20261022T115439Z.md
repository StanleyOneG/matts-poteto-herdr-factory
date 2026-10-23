# Продолжение #41: согласованное упрощение Legion

## Сначала: граница разрешения

Пользователь попросил handoff для новой сессии. **Это НЕ согласие на начало реализации.** Последний вопрос координатора остался без ответа:

> Разрешаешь запретить изменение зависимостей задачи после её первого запуска (изменение scope — новая задача) и реализовать первый этап: A→B, отказ запуска B, явная приёмка A после обычных checks/review/Git integration, минимальная identity/ancestry проверка, затем readiness и явный запуск B?

Это **рекомендация, ещё не принятое правило**. Сначала получить ответ. Пользователь уже разрешил и мы выполнили обновление #1/#41, архитектурных документов и подготовку плана — **без production-кода**. Не начинать весь план, тесты, install/live trials или закрытие старых actors из одного запроса handoff. Общий исходный implement-запрос требовал TDD, focused tests/typecheck, final full suite, independent review и commit в текущую ветку; позднейший документационный этап сузил текущую исполнительную границу. Нет разрешения на push, merge main, реальную публикацию результатов продукта/закрытие issues или уничтожение ресурсов.

## Почему сменили направление

До этой сессии #41 несколько дней пытались завершить через installed trial. Direct journey был принят, но branching A после реализации несанкционированно начал подготовку reviewer. Git branch создалась, durable outcome не записался (`database is locked`), остались allocation hold и immutable blocked report. Причина lock/точный SQL не установлены. Поддерживаемого восстановления живого экземпляра нет; новое source не обновляет его closure, а снятие hold не исправляет отдельный reporting gate.

Мы сперва спроектировали retained allocation disposition и проверили возможность применения. Это **только отчёты**, код не писали. Пользователь остановил направление: нужен лёгкий extension, а не новый recovery framework. В ходе grilling согласовали новый продуктовый контракт. **Спасение старого A не является релизной целью; не делать новую подсистему ради исторического прогона.** Старые результаты/сбои не превращаются в успешные проверки новой версии.

## Авторитетный новый контракт — читать, не восстанавливать по этому резюме

- https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/1 — опубликованный актуальный target.
- https://github.com/StanleyOneG/matts-poteto-herdr-factory/issues/41 — опубликованные заменённые acceptance checks, OPEN.
- `docs/adr/0002-lightweight-legion-boundary.md` — принятое решение; частично supersedes ADR0001.
- `docs/plans/legion-lightweight-v1.md` — карта KEEP/DELEGATE/DELETE и шесть вертикальных этапов.
- `docs/agents/legion-engineering-policy.md`, `GLOSSARY.md` — согласованы с новым контрактом.

Основные принятые решения (подробности в источниках):
- Extension: локальные задачи, явные prerequisite edges, gate запуска по принятому результату, изолированные интерактивные Tribuni, attempts/ownership и наблюдаемое состояние. **Не scheduler**: Legatus задаёт связи и явно запускает.
- Legatus + skills: TDD/методология, содержательные checks/review/приёмка. Явная приёмка после checks, независимого review и обычной Git integration; код проверяет caller/task/attempt/result identity, допустимый переход и минимальный факт ancestry commit в intended parent. Удаляем собственный proof-протокол, не отменяем качество работы.
- Git integration и tracker/PR — обычные инструменты/skills; убрать custom integration/delivery lifecycles/adapters, не заменить новой обёрткой.
- Centuriones — обычный `pi-subagents`, без Legion child registration/wrapper/custom workspace allocation. Параллельные writers всё ещё изолированы.
- Handoff — неизменённый handoff skill под управлением Legatus: purpose/continuation, настоящий temporary path, stopped writer перед reuse worktree, read-first new session, сохранение dirty bytes/model/profile. Никакой собственной successor state machine. Native compaction остаётся включена.
- Неудачная попытка может завершиться без acceptance; запись ended НЕ означает остановку процесса/cleanup/разрешение зависимостей. Неизвестные эффекты сохраняются, не replay. При неизвестном старом writer — новый отдельный worktree.
- Restart сохраняет pointers, но не автоматически reattach/adopt/replay старых actors.
- Пользователь уточнил: **старых пользовательских записей ещё нет**, migration compatibility layer не нужен. Реальные тестовые runtime/ветки/evidence существуют и сохраняются отдельно.
- Условия permissions/Trust, корректной принадлежности ресурсов, shell launch, model/profile/config/context, Matt vs poteto и удержания worktrees/branches сохранены. Poteto OFF.
- Старые custom draft-ready/recovery критерии #41 **replaced, not passed**. Нужны новые representative journeys и финальные проверки.

Открытые детали: graph edits/revocation после запуска/приёмки (задан вопрос выше); публичное имя failed-attempt-end; судьба `/legion resume` (pointer-only или убрать с ясной подсказкой). Не сохранять старый reconciler ради совместимости. API/структура файлов — минимальные implementation details в рамках утверждённого поведения.

## Что выполнено в этой сессии

1. Прочитан прежний handoff и отчёты по blocker. Никаких изменений durable runtime.
2. Два ограниченных дизайн-исследования показали, что recovery не решает текущий trial без дальнейшего expansion. Их рекомендации superseded новым направлением; не реализовывать их.
3. Проверены актуальные #1/#41 и текущая ответственность кода. Важный факт: в прежней модели `TaskRef` нет prerequisite edges/launch-time dependency gate, хотя prompt поручает граф Legatus. Большие подсистемы доказательств/integration/delivery при этом существуют. Размер файла сам по себе не объявляли дефектом.
4. Проведён grilling, все основные решения приняты. Пользователь явно подтвердил полное понимание и разрешил docs/tracker/plan.
5. Один docs-writer изменил ровно пять путей (список ниже), подготовил issue drafts. Предыдущие 21 dirty candidate files были проверены byte-identical. `git diff --check`, relative links, scope/index проверки прошли; продуктовые тесты не запускались.
6. Fresh independent docs review: **no findings / OK**. Это review docs, не acceptance production-кандидата.
7. Координатор опубликовал тела #1/#41 через `gh issue edit --body-file`. Перед каждым write сверены fresh original body SHA и reviewed draft SHA; после write точное read-back equality и OPEN. Ни issue не закрыт, title/labels/comments не меняли.

### Документационные изменения (не commit)

- `GLOSSARY.md`
- `docs/adr/0001-native-workflows-and-local-ownership.md` — минимальный supersession pointer
- `docs/adr/0002-lightweight-legion-boundary.md` — новый
- `docs/agents/legion-engineering-policy.md`
- `docs/plans/legion-lightweight-v1.md` — новый

#41 metadata по последней проверке всё ещё содержит CLOSED blockers #39/#40/#37. Их закрытость историческая, не acceptance нового target. Тела issues это объясняют; dependency metadata не меняли и новые tickets не создавали. Перед изменением tracker — `docs/agents/issue-tracker.md`; не менять labels без triage policy.

## Отчёты и evidence (дисковые, coordinator custody)

Основной каталог **R=/workspaces/astraprojects/.tmp/i41-accept2**:
- `lightweight-contract-update-report.md` — docs writer scope/validation и draft manifest.
- `lightweight-docs-review.md` — независимый review опубликованных drafts/docs.
- `lightweight-scope-audit.md` — factual #1/#41/code audit ДО изменения target.
- `simplification-responsibility-map.md` — source map ДО окончательных решений Q4–Q14; рекомендации KEEP integration/delivery и старых gates **устарели**. Использовать только source facts с перепроверкой.
- `allocation-recovery-design.md`, `held-actor-application-design.md` — исторический дизайн, **не approved implementation plan**.
- `a-allocation-hold-diagnosis.md`, `a-independent-review.md`, `branching-recovery-trial.762655b1.86c74016.md` — подробный старый blocker/commit/evidence/custody.
- `direct-0791-trial.0dcd6c12.6d4ce26d.18fa3d74.md` — исторический accepted direct.
- `herdr-cleanup-current.md`, `herdr-tab-cleanup-assessment.md` — cleanup факты/ограничения.

**D=/workspaces/astraprojects/.tmp/lw-docs.5tgW8U**: `issue-manifest.json`, original body/JSON, reviewed drafts, `issue-{1,41}.prepublish.json`, `.publish-receipt.json`, `.published.json`, validation и candidate hashes. Это retained review/publication evidence, не удалять до окончания consumers. Не считать старые issue1.json/issue41.json в R актуальным контрактом после публикации.

## Git и существующий candidate

Repo `/workspaces/astraprojects/matts-poteto-herdr-factory`, текущая ветка **main**, HEAD при handoff **c5e51c3ed1fe1cdd9848fb43a193c7bc4cc74dc1**. Индекс пуст. Commit не сделан. Preserve dirty state полностью; не reset, не stage чужие изменения. В начале реализации сначала явно учесть, какие старые исправления нужны новому target; нельзя удалить файлы просто потому, что они untracked.

Помимо пяти docs, до этой сессии modified: `package.json`, `package-lock.json`, `src/centuriones.ts`, `src/preflight.ts`, `src/tribunus-host.ts`; tests `launch`, `native-sdk-denial`, `native-sdk-matt-initialization`, `native-sdk-workflow`, `preflight`, `principal-compatibility`; support `composed-transport.mjs`, `legatus-ui.mjs`, `native-sdk-workflow.mjs`.
Untracked candidate: tests `centurio-launch-shape`, `controlled-delivery-provider`, `native-sdk-resolution`, `tribunus-launch-environment`; support `controlled-delivery-provider.md/.ts`, `native-sdk-resolution.mjs`.

Исторические исправления: empty stdout completion-only pane run, shell readiness identity marker, native Centurio options shape, qualification **pi-subagents0.79.1** (пользователь отдельно требовал эту версию), controlled delivery fixture. Новый target удаляет часть потребителей; сохранять всё пока scoped implementation не определит disposition. Подробные focused checks/reviews в R (empty-output*, shell-readiness*, readiness*, shape*, 0791*, fixture*). Финальный full suite **ещё не запускался как release gate**, README всё ещё старой реализации.

## Herdr cleanup: что реально сделано

Пользователь попросил закрыть ненужные связанные вкладки. Проведены свежие topology/process/receipt проверки, **закрытий и Pi exit — 0**, управление не отправлялось.
- `w1:t2K / w1:pB0 / term_65e127afe3c1cc0`: старый canonical-shape trial объявлен coordinator больше не нужным для continuation. Но fresh native settlement не подтверждён в разрешённой secret-free области доступа. Receipt reconciliation показывает historical settlement-pending marker не обязательно active work, corrections были delivered, все recorded effects completed; этого недостаточно для live queues/hold/children settlement. Без доказательства не закрывать.
- `w1:t2M/pC2` owner, `w1:t2P/pCE` retired predecessor, `w1:t2Q/pCG` held successor удержаны. Новое направление не требует спасать их trial, но это **не свежая cleanup eligibility**. Перед closure отдельно проверить owners/occupants/children/effects/consumer need; не объявлять hold снятым.
- `w1:t1A` текущий coordinator `pA6` + пользовательские панели: не закрывать.
- `w1:t1X` increase tmp, pAB/pAC/pAD смешанные human/unowned: пользователь ещё не ответил, нужна ли она. Не закрывать из одного idle/cwd.
- Остальные проекты исключены.

Safe cleanup evidence `/workspaces/astraprojects/.tmp/hcl-Sx3V`, прежний `/workspaces/astraprojects/.tmp/hca-86a5`. Точные старые identities/limitations — в отчётах; не использовать их как актуальную live authority.

В cleanup-подзадаче metadata read одного `*.22.context.json` неожиданно показал capability envelope. Значение не использовано/не повторено/не скопировано в evidence. Supervisor запретил читать/использовать bootstrap capabilities; секрет-free observation surface не установлен. Не повторять чтение, не публиковать секрет, не rotate/править journals самостоятельно. Полный путь incident записан без значения в cleanup report. Не читать `a/auth.json`, не архивировать private runtime roots.

Исторический runtime **N=/workspaces/astraprojects/.tmp/c41-naadz_o2**, installed package **K=/workspaces/astraprojects/.tmp/q791-4FmA**, branching **E=/workspaces/astraprojects/.tmp/br41-GfGF**. Сохранить worktrees/branches/journals и временный native handoff под N/t, не копировать его тело в постоянные docs. A commit **90383fbfcb293c86cc683c1e9f1168092cf577d6**, partial allocation **a2ea87a5-10bb-4b6b-a1f5-51b1d6888c3b**, claim **c4e7ab7e-8631-4d56-b528-441afd33f82e** остаются историческими unaccepted данными. Не дописывать outcomes, не replay/delete branch.

## Диск и временные данные

Пользователь повторно требует следить за `/` и `/tmp`; bulk файлы/сборки/fixtures/cache/logs — на рабочем диске в `.tmp`, не container root и не tmpfs. Принятый policy base **/workspaces/astraprojects/.tmp** (ext4). Перед tests/native checks/delegation/cleanup читать `.agents/skills/temp-storage/SKILL.md`; короткие уникальные owned roots, TMPDIR/TMP/TEMP и tool caches задать явно; проверять actual writes. Не мигрировать текущий runtime и не чистить чужое.

Последняя проверка **2026-10-22 11:54 UTC**: `/`9.2GiB свободно, `/tmp`7.7GiB (12MiB used), workspace284GiB. Значительное освобождение произошло без нашей cleanup-команды; причину/автора не знаем. **Старый `/tmp/handoff-issue41-20261019T141320Z.md` больше НЕ существует** — не полагаться на него. Его необходимые текущие факты перенесены сюда; остальные сохранены в R reports. Managed /tmp subagent paths тоже могли исчезнуть; не возобновлять завершённых children по старым IDs. Все работы этой сессии завершены, известных pending supervisor requests нет.

Этот небольшой handoff записан именно в OS `/tmp`, потому что пользовательский handoff skill явно требует OS temp и TMPDIR пуст. Не считать это разрешением на bulk туда.

## Рекомендуемое продолжение

1. Прочитать актуальные #1/#41, ADR0002, policy и план. Сверить dirty git, не запускать tests/full suite на docs-only gate.
2. Получить ответ на последнее предложение: неизменяемость prerequisite edges после первого запуска + разрешение первого implementation slice. Запрос handoff ответом не является.
3. После approval — один bounded implementation owner, public TDD seam, focused typecheck/test regularly, заменять старые пути, не наращивать параллельные proof subsystems. Учесть preserved candidate. Последующие slices — по согласованному плану и scope, не автоматический redesign.
4. Final integrated suite once at end, fresh independent Standards+Spec review exact integrated result; commit в текущей ветке согласно отдельной актуальной границе. Не push/close issues/публиковать продукт без гранта.

## Suggested skills

Если есть Skill tool — вызывать им, иначе читать SKILL.md:
- `grilling` — если нужно закрыть оставшийся graph-edit policy вопрос; основные Q1–Q14 уже решены, не интервьюировать заново.
- `implement` и `matt-tdd` — только после явного разрешения implementation slice.
- `codebase-design` — минимальные interfaces/seams без нового framework.
- `domain-modeling` и `writing-for-agents` — если изменяются принятые ADR/glossary/policy.
- `code-review` — независимый Standards+Spec review кода, не считать docs review заменой.
- `temp-storage` — до тестов/делегирования/cleanup.
- `pi-subagents` — bounded delegation. Implementation worker `openai-codex/gpt-6.1-sol`; judgment/review `openai-codex/gpt-6-astra`; scout/why `openai-codex/gpt-6-luna`. Каждый child timeoutMs5400000, outer workflow21600000; disk-backed reports, no nested fanout by default. Poteto OFF.
- `herdr` — только при явной задаче inspect/control, HERDR_ENV=1, explicit returned IDs и fresh eligibility.

Не нужно снова запускать allocation-recovery design или живые модельные reenactments для уже известных фактов.
