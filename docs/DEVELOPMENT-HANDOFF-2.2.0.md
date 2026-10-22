# 2.2.0 开发交接

本轮范围：总控同页、逐项派工批准、文案到配图、导入Skills编辑、终态任务移除；保留账号矩阵归属与既有发布确认范围。

任务移除立即记录本地已删除ID，阻止旧轮询列表重新选中；历史抽屉同步通知总控清除当前焦点；已删除任务的旧链接显示提示且不再提供派工/重试。

关键文件：App.tsx/workspace-route.mjs规范化tasks链接；WorkControl.tsx统一任务、成果、修改；WorkDispatch.tsx明确规则选择与费用；WorkMedia.tsx独立图片卡与审批弹窗。work-dispatch-control.mjs提供冻结报价和单任务批准；work-control.mjs负责待批准状态、重试、草稿和成果版本。work-media.mjs创建绑定成果/账号的图片槽，cover-request.mjs支持逐次规则和持久请求去重。

确认计划不读取凭证、不排队业务调用；估算不调用模型。批准后冻结输入、Skills和前置成果版本。默认规则不会隐式加入全局自装Skills。账户、服务连接、版本及并发修订均需核对。新重试不能继承收费批准。图片设置保存到按成果版本隔离的mediaDrafts，审批本身不持久恢复。

Windows构建：先npm run build，再npm run build:windows；package.json为2.2.0，输出到新版本目录，保留旧包。Start-App.cmd调用按版本选包的start-windows.ps1，不改用户快捷方式、不终止用户程序。

最终检查见VALIDATION-2.2.0.md。合成适配器验证不代表真实付费模型、平台采集发布、通知或休眠恢复已经实机测试。
