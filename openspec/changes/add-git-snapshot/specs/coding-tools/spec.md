# Capability: coding-tools (Delta: write_file 覆写前 git 快照)

## ADDED Requirements

### Requirement: 覆写前自动快照

`write_file` 在覆写**已存在**的文件前，若工作区位于 git 仓库内，MUST 先用
`git hash-object -w` 将原文件内容写入对象库创建快照，并 SHALL 在结果中附上
blob SHA 与恢复命令。快照 MUST NOT 触碰索引、工作区状态或提交历史。

#### Scenario: 覆写仓库内已有文件

- **WHEN** `write_file` 覆写 git 仓库内已存在的文件
- **THEN** 工具结果 SHALL 包含快照 SHA 与 `git cat-file blob` 恢复提示
- **AND** 通过该 SHA SHALL 能完整恢复覆写前的文件内容
- **AND** `git status` 等仓库状态 SHALL NOT 因快照发生变化

#### Scenario: 新建文件不快照

- **WHEN** `write_file` 创建不存在的新文件
- **THEN** SHALL NOT 创建快照，结果保持标准格式

### Requirement: 快照失败不阻塞写入

快照是非关键安全兜底：非 git 仓库、git 命令缺失或哈希失败时，`write_file`
MUST 静默跳过快照并正常完成写入，结果 SHALL NOT 包含快照信息。

#### Scenario: 非 git 目录写入

- **WHEN** 工作区不在 git 仓库内且覆写已有文件
- **THEN** 写入 SHALL 正常完成
- **AND** 结果 SHALL 与无快照功能时完全一致
