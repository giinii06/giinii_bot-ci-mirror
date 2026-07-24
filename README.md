# Discord XP Bot

Discord Developer Portal에서 봇에 `Guilds`, `Guild Messages`, `Guild Voice States` intent를 켠 뒤, 봇 권한에 `Manage Roles`와 `Send Messages`를 부여하세요. 역할 구매를 위해 봇 역할은 판매 역할보다 위에 있어야 합니다.

```sh
cp .env.example .env # DISCORD_TOKEN 입력
bun install
bun run start
# 또는 docker compose up -d --build
```

데이터는 `./data/bot.sqlite`에 저장됩니다. 일/주/월 통계는 한국 표준시(KST) 기준입니다.

| 명령어 | 설명 |
| --- | --- |
| `/리더보드` | 누적 XP 상위 10명을 이미지로 표시 |
| `/경험치샵` | 판매 역할 목록 및 구매 |
| `/경험치샵물품추가 역할:@역할 가격:1000` | 관리자 상점 등록 |
| `/경험치샵목록삭제 물품:@역할` | 관리자 상점 삭제 |
| `/송금 얼마:100 유저:@유저` | 송금인·수신인 프로필 사진이 포함된 공개 XP 송금 영수증 이미지 |
| `/xp추가`, `/xp제거` | 관리자 수동 XP 조정 |
| `/채널설치 종류:레벨업 채널:#채널` | 관리자 로그 채널 설정 |
