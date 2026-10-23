# CVAT Track Refiner

**Bản thử nghiệm v0.3.2 · Dựng hình LiDAR qua nhiều frame và chỉnh box chung trên CVAT**

[English](README.md) | **Tiếng Việt**

[Tải các bản phát hành](https://github.com/phanhieunghia353/cvat-track-refiner/releases) · [Bản hiện tại: v0.3.2](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.3.2) · [Kiểm chứng](VALIDATION.md) · [Thiết kế](DESIGN.md) · [Lịch sử thay đổi](CHANGELOG.md)

CVAT Track Refiner là extension trình duyệt để quan sát một vật thể LiDAR được tracking xuyên suốt nhiều frame. Tool căn các điểm bề mặt quan sát được về một hệ tọa độ chung của vật thể, cho phép kiểm tra nguồn frame của từng vùng và cung cấp editor box chung tùy chọn. Box chung do người gán nhãn kiểm tra có thể được chiếu trở lại những frame có tư thế được hỗ trợ trong track đã chọn.

Tool chạy cục bộ trên Brave, Chrome hoặc Edge bằng JavaScript, Web Worker và Canvas. Người dùng extension không cần Python, GPU chuyên dụng, model weights, server suy luận riêng hoặc quyền quản trị host CVAT. Tool dùng đúng tab bạn chủ động mở và phiên đăng nhập CVAT hiện có; không yêu cầu nhập token hay khóa cứng hostname.

**Trạng thái:** đây là công cụ hình học thử nghiệm. Lõi mặc định chưa tự nhận dạng hoàn chỉnh xe, phân biệt thân xe với gương, dựng phần khuất hoặc chứng minh kết quả tốt hơn pre-label có sẵn. Tests và mẫu tổng hợp không chứng nhận tương thích với mọi host CVAT tùy biến. Giao diện hiện bằng tiếng Việt; hai bản README mô tả cùng hành vi.

## Mục lục

- [Gói tải và lịch sử phát hành](#gói-tải-và-lịch-sử-phát-hành)
- [Điều kiện sử dụng](#điều-kiện-sử-dụng)
- [Cài lần đầu](#cài-lần-đầu)
- [Cập nhật giữ nguyên backup](#cập-nhật-giữ-nguyên-backup)
- [Bắt đầu sử dụng](#bắt-đầu-sử-dụng)
- [Cách lõi dựng hình hoạt động](#cách-lõi-dựng-hình-hoạt-động)
- [Kiểm tra bề mặt và chỉnh box chung](#kiểm-tra-bề-mặt-và-chỉnh-box-chung)
- [Apply, Save, Undo và bảo vệ ID](#apply-save-undo-và-bảo-vệ-id)
- [Các file xuất và dữ liệu riêng tư](#các-file-xuất-và-dữ-liệu-riêng-tư)
- [Xử lý lỗi thường gặp](#xử-lý-lỗi-thường-gặp)
- [Giới hạn và chất lượng](#giới-hạn-và-chất-lượng)
- [Phát triển và kiểm chứng](#phát-triển-và-kiểm-chứng)
- [Giấy phép và nguồn tham khảo](#giấy-phép-và-nguồn-tham-khảo)

## Gói tải và lịch sử phát hành

Vào [GitHub Releases](https://github.com/phanhieunghia353/cvat-track-refiner/releases), mở **Assets** dưới phiên bản muốn tải. Đây là các **Release đã xuất bản**, không chỉ có Git tag. Các bản được đánh dấu **Pre-release** vì đang thử nghiệm, chưa được công bố là bản production ổn định.

| Asset v0.3.2                                                                                                                                                         | Dùng để làm gì                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [cvat-track-refiner-brave-v0.3.2.zip](https://github.com/phanhieunghia353/cvat-track-refiner/releases/download/v0.3.2/cvat-track-refiner-brave-v0.3.2.zip)           | Extension đóng sẵn để nạp vào trình duyệt Chromium        |
| [cvat-track-refiner-source-v0.3.2.zip](https://github.com/phanhieunghia353/cvat-track-refiner/releases/download/v0.3.2/cvat-track-refiner-source-v0.3.2.zip)         | Source, comment, tests và tài liệu tại thời điểm đóng bản |
| [cvat-track-refiner-v0.3.2-SHA256SUMS.txt](https://github.com/phanhieunghia353/cvat-track-refiner/releases/download/v0.3.2/cvat-track-refiner-v0.3.2-SHA256SUMS.txt) | SHA256 của hai ZIP gốc                                    |

Các mục **Source code (zip/tar.gz)** do GitHub tự tạo chứa repository tại tag, không phải ZIP extension đóng sẵn. Nếu dùng source checkout, hãy nạp thư mục `extension/`.

| Release                                                                              | Thay đổi chính / trạng thái lịch sử                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [v0.3.2](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.3.2) | Kiểm tra ID/thứ tự native và server, audit từng frame, backup/log bền vững và kiểm tra chỉ đọc sau Save |
| [v0.3.1](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.3.1) | Bỏ writer thay object, chuyển sang chỉnh points native tại chỗ và hoàn tác toàn đợt                     |
| [v0.3.0](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.3.0) | Lõi dựng hình đầu tiên, viewer 3D có truy nguồn và editor box chung; đường Apply của bản này làm đổi ID |
| [v0.2.1](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.2.1) | Bộ fit cũ có kiểm tra box cuối trên từng frame                                                          |
| [v0.2.0](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.2.0) | Lọc bằng chứng theo thời gian; kiểm tra sau bước căn tâm cuối còn thiếu                                 |
| [v0.1.0](https://github.com/phanhieunghia353/cvat-track-refiner/releases/tag/v0.1.0) | Bộ fit đầu tiên; cụm điểm ngoài có thể kéo box đề xuất nở ra                                            |

Các gói cũ được giữ để truy vết, không khuyến nghị dùng để Apply. Đặc biệt, không dùng đường Apply v0.3.0 khi cần bảo toàn ID. **v0.3.2 không tự khôi phục các ID đã bị bản cũ đổi.**

Tài liệu cập nhật ngày **23/10/2026**: README tiếng Anh và tiếng Việt hiện tại cũng được đính kèm riêng trong Release v0.3.2. ZIP, checksum và tag gốc được giữ nguyên; README nằm trong ZIP phản ánh thời điểm đóng gói ban đầu.

## Điều kiện sử dụng

- Trình duyệt Chromium hỗ trợ Manifest V3 và `chrome.scripting`; manifest yêu cầu Chromium từ 111. Luồng sử dụng chính là Brave; Chrome và Edge cũng là nền tảng mục tiêu. Gói này chưa hỗ trợ Firefox.
- Đăng nhập vào một **job CVAT 3D LiDAR**, có cuboid track và quyền xem annotation/point-cloud frame liên quan. Apply cần quyền sửa annotation thông thường của tài khoản.
- Frame PCD truy cập được từ cùng origin CVAT. Hỗ trợ ASCII, binary và binary_compressed/LZF PCD, tọa độ float32/float64.
- Frame trong job liên tiếp. Tool từ chối frame filter/step khác 1.
- Apply yêu cầu đọc được ID annotation đã lưu trên server và phiên native CVAT tương thích. Cùng số version CVAT không bảo đảm host tùy biến có cùng hành vi.

Ubuntu, Windows và macOS là các nền tảng mục tiêu; chưa kiểm chứng đầy đủ cài native và khả năng tương thích trên mọi trình duyệt/hệ điều hành. Môi trường được báo cáo là CVAT 2.77.1, nhưng bộ test tự động chưa chứng nhận Save/Auto save trên host thật đó.

## Cài lần đầu

1. Tải ZIP có chữ **brave** trong **Assets** của release.
2. Giải nén vào thư mục cố định. Không nạp extension từ một thư mục tạm sẽ bị xóa sau đó.
3. Mở `brave://extensions` (hoặc `chrome://extensions` / `edge://extensions`), bật **Developer mode**.
4. Chọn **Load unpacked**, trỏ tới thư mục `cvat-track-refiner/` có `manifest.json`. Nếu dùng repository checkout, chọn `extension/`.
5. Tạm tắt các extension chỉnh kích thước annotation khác để chỉ một tool điều khiển thao tác đang kiểm tra.
6. Mở tab job CVAT và bấm biểu tượng **CVAT Track Refiner · Experimental** trên thanh trình duyệt.

Panel gắn với tab bạn dùng để mở tool. Chuyển tab trình duyệt không khiến panel cũ tự đổi mục tiêu. Không cần reload trang CVAT để phân tích hoặc Apply.

Nếu máy có `sha256sum`, đặt hai ZIP và file checksum cùng thư mục rồi kiểm tra:

```sh
sha256sum -c cvat-track-refiner-v0.3.2-SHA256SUMS.txt
```

## Cập nhật giữ nguyên backup

**Giữ đúng ID extension và đường dẫn đã cài. Không gỡ extension, không xóa storage, không Load unpacked bản mới từ thư mục khác.** Một bản nạp từ đường dẫn khác có thể nhận ID extension khác và không tự đọc được backup của bản cài cũ.

1. Tải backup/log hiện có nếu panel cũ còn mở được. Giữ thư mục cài và dữ liệu trình duyệt.
2. Đóng panel của tool.
3. Giải nén ZIP mới vào thư mục tạm; chép **nội dung bên trong** `cvat-track-refiner/` đè vào đúng thư mục Brave đang nạp. Tránh tạo thêm một thư mục `cvat-track-refiner/` lồng bên trong.
4. Vào `brave://extensions`, bấm **Reload trên thẻ extension**. Đây là reload extension, không phải reload tab CVAT.
5. Mở lại tool từ tab job rồi Đọc job. Dùng **Tải lịch sử backup/audit** để giữ thêm bản sao riêng trên máy.

Cập nhật tool không khôi phục ID annotation đã bị đổi trên server. Nó cũng không tự chuyển backup từ profile trình duyệt hoặc bản cài extension khác.

## Bắt đầu sử dụng

### Thử trước bằng dữ liệu tổng hợp

Bấm **Thử dữ liệu mẫu**, sau đó **Phân tích**. Mẫu lõi mặc định có thân cong tổng hợp và tư thế ban đầu bị jitter. **Mẫu có cụm điểm ngoài** là tình huống nhiễu riêng. Apply luôn bị khóa khi dùng demo. Đây là tình huống có kiểm soát, không phải scan thật của người dùng hoặc benchmark độ chính xác trên xe thật.

### Đọc job thật

1. Chọn một object có track trong CVAT; kết thúc thao tác kéo hoặc nhập đang diễn ra.
2. Mở extension, bấm **Đọc job / object đang chọn**.
3. Kiểm tra job, **client ID thực trong CVAT** và khoảng frame. ID cơ sở dữ liệu trên server là một mã khác; không suy mã này từ mã kia.
4. Giữ **Lõi dựng hình + box chung**, chọn khoảng có các quan sát chồng lấp hữu ích rồi **Phân tích**.
5. Kiểm tra hình ghép **và từng frame riêng** trước khi tạo hoặc Apply box.

Tool đọc cả annotation chưa Save từ phiên CVAT đang mở. Phân tích không yêu cầu Save trước. Apply có kiểm tra ID chặt hơn và có thể bị chặn dù vẫn phân tích được.

## Cách lõi dựng hình hoạt động

Lõi tách **tái dựng bề mặt** khỏi **quyết định box bao**:

1. Dùng tư thế pre-label và vùng crop mở rộng để khởi tạo, gợi ý vùng tìm.
2. Tải các frame PCD được lấy mẫu từ cùng origin CVAT. Giải mã cục bộ và giữ crop giới hạn trong worker.
3. Đánh dấu mặt đất/object lân cận bằng mask ngữ cảnh. Nhánh dựng hình vẫn giữ các quan sát này để kiểm tra; chúng không tham gia căn chỉnh.
4. Ước lượng thông tin bề mặt cục bộ, tinh chỉnh dịch X/Y/Z và yaw bằng khớp bề mặt có cơ chế giảm ảnh hưởng sai lệch lớn. Frame mốc cố định hệ chung; frame ghim bổ sung giữ tư thế pre-label được người dùng tin cậy.
5. Kiểm tra các ràng buộc căn và tập điểm giữ riêng để kiểm tra. Mặt phẳng thiếu ràng buộc, các quan sát không nối được hoặc không đạt kiểm tra được giữ ở trạng thái chưa xác định.
6. Hợp nhất quan sát được chấp nhận thành các ô bề mặt, giữ ID frame nguồn và độ phân tán. Bề mặt chỉ thấy ở một frame vẫn có thể được giữ; ít quan sát không tự chứng minh đó là nhiễu.
7. Người gán nhãn có thể tùy chọn chỉnh box chung. Tool chiếu box qua các tư thế được hỗ trợ để tạo draft trên track đã chọn.

Lõi mặc định **không lấy các điểm ngoài cùng để tự tính kích thước box**. Kích thước pre-label là gợi ý crop, không phải hình dạng tái dựng cuối. Đây chưa phải model học sâu, dựng vật thể hoàn chỉnh, kiểm chứng vùng trống bằng ray tracing hoặc phân đoạn ngữ nghĩa thân xe/gương.

Chế độ riêng **Bộ fit box cũ (đối chiếu)** ước lượng kích thước và tư thế cục bộ bằng bằng chứng theo thời gian, thành phần liên thông, biên dải thân và kiểm tra chấp nhận thận trọng. Nó được giữ để đối chiếu và vẫn có giới hạn đã biết; không phải lõi dựng hình mặc định. Xem [DESIGN.md](DESIGN.md) và [RECONSTRUCTION-CORE.md](RECONSTRUCTION-CORE.md).

## Kiểm tra bề mặt và chỉnh box chung

| Điều khiển / kết quả              | Ý nghĩa                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Kéo / cuộn trong viewer 3D        | Xoay / phóng to thu nhỏ; có nút đặt lại và điều khiển góc                                                    |
| **Màu theo**                      | Nguồn frame, số frame hỗ trợ hoặc độ phân tán; không phải xác suất đúng đã hiệu chuẩn                        |
| Bấm điểm bề mặt                   | Xem quan sát đóng góp; ID điểm thuộc crop/bề mặt, không phải chỉ số PCD gốc                                  |
| **Quan sát → Frame …**            | Xem riêng frame sau khi đưa về hệ chung                                                                      |
| Hình chiếu X/Y, X/Z, Y/Z          | So hình học từ ba hướng                                                                                      |
| Checkbox hiển thị frame           | Chỉ đổi hình vẽ, không đổi kết quả căn hoặc phạm vi Apply                                                    |
| **Loại / nhận lại frame chọn**    | Bỏ/nhận frame và dựng lại từ crop đang giữ                                                                   |
| **Chọn làm mốc**                  | Cố định hệ tọa độ theo pre-label của frame được chọn                                                         |
| **Ghim / bỏ ghim theo pre-label** | Ghim/bỏ ghim tư thế một frame bổ sung                                                                        |
| **4/4**                           | Hệ phương trình hỗ trợ X/Y/Z và yaw theo ngưỡng hiện tại; không phải phần trăm tin cậy hay chứng nhận sai số |
| **Chưa xác định**                 | Căn thiếu bằng chứng/không đạt; không coi tư thế frame này đã được tái dựng đáng tin cậy                     |

Đổi mốc hoặc dựng lại sẽ hủy đề xuất box cũ và khởi tạo lại editor. Mốc là giả định, không phải ground truth. Muốn sửa tư thế pre-label của mốc, chỉnh trong CVAT rồi Đọc và Phân tích lại.

Để tạo đề xuất box:

1. Mở **Box chung chỉnh tay**. Giá trị ban đầu lấy từ pre-label của mốc, chưa phải phép đo tự động mới.
2. Bật **Hiện box chung**, chỉnh tâm X/Y/Z, yaw, dài/rộng/cao bằng ô số. Bản này chưa có tay nắm kéo các mặt box.
3. Kiểm tra nhiều hình chiếu và frame. Người dùng quyết định quy tắc nhãn có tính gương/phần nhô hay không; lõi chưa tự quyết định.
4. Bấm **Tạo đề xuất từ box tôi chỉnh**. Chỉnh tiếp bất kỳ giá trị số nào sẽ hủy draft đang có.
5. Đọc số frame đổi, số keyframe thêm và số frame nội suy. Kích thước dùng chung kết hợp với từng tư thế được hỗ trợ; mẫu chưa xác định và khoảng nội suy bị chặn giữ nguyên hình học gốc.
6. Chỉ **Apply vào CVAT** sau khi kiểm tra draft. Tool kiểm tra giới hạn kích thước/dịch/xoay và từ chối giá trị vượt giới hạn, không âm thầm cắt bớt.

Mặc định lấy mẫu 24 frame, tối đa 48. Dựng từ mẫu không có nghĩa mọi frame trong khoảng Apply đã được kiểm chứng độc lập bằng point cloud riêng của nó.

## Apply, Save, Undo và bảo vệ ID

### Apply đổi những gì

Apply chỉnh `ObjectState.points` native của track được chọn và gọi `ObjectState.save()` cục bộ. Tool có thể thêm keyframe để biểu diễn draft đã duyệt và giữ biên nội suy. Nó không thay track, import collection hoặc gọi HTTP API ghi annotation. Roll/pitch, padding, class, group, attributes, visibility và ID cũ được bảo toàn; CVAT có thể đánh dấu `source` đã chỉnh, ví dụ auto → semi-auto.

Tool không gọi Save server của CVAT, không reload job và không đổi Auto save. **Được phép bật Auto save; CVAT có thể lưu trước khi bạn kiểm tra bằng mắt.** Nếu muốn tự kiểm tra trước khi dữ liệu được lưu, hãy tự tắt Auto save trong CVAT trước Apply.

### Các chốt ID của v0.3.2

1. Trước lần sửa đầu, đọc annotation đã lưu bằng GET cùng origin có giới hạn tài nguyên. Yêu cầu thứ tự/ID native và server khớp, keyframe cũ giữ đúng ID và baseline phiên còn mới. Object cấp cao chưa Save, ID thiếu/trùng hoặc số client không khớp thứ tự nạp lại sẽ chặn Apply.
2. Lưu snapshot annotation trước sửa và journal riêng từng lượt vào `chrome.storage.local`; đọc lại để xác minh trước khi gửi lệnh sửa. Không tự ghi đè/xóa backup trước. Lỗi quota/đọc lại chặn Apply.
3. Sau **mỗi lần sửa frame native**, so thay đổi được phép của track chọn, mọi ID và thứ tự, cùng toàn bộ nội dung tracks/shapes/tags/intervals ngoài phạm vi. Audit chỉ đọc dữ liệu; không thử sửa nhãn khác để kiểm tra.
4. Nếu lệch, dừng và khóa Apply tiếp. Không lặp lại lệnh chưa rõ kết quả hoặc tự ghi đè job bằng backup. Journal chưa xác minh tiếp tục chặn khi mở lại panel.
5. Cuối đợt, kiểm tra lại ID đã lưu trên server. Điều này chỉ xác nhận thời điểm kiểm tra, không chứng nhận một lần Save tương lai.
6. Sau Save/Auto save, bấm **Kiểm tra ID sau Save (chỉ đọc)**. Nút đọc dữ liệu native/server và mốc ID đã lưu; phân biệt ID khớp với toàn bộ nội dung phiên/server khớp. Thêm/xóa object hợp lệ cũng có thể cần đối chiếu thủ công vì bản đồ ID trước đó đã đổi.

Các chốt này phát hiện tác dụng phụ **sau** lời gọi native. Chúng không thể bảo đảm trước hành vi của mọi host CVAT tùy biến hoặc extension khác. Audit cục bộ thành công không bảo đảm cho thay đổi ngoài tool sau đó. Bản này không tự khắc phục sự cố mất ID của các bản cũ.

### Undo và lỗi giữa chừng

- **Hoàn tác Apply gần nhất** trả lại đợt đã audit khi snapshot/lịch sử còn khớp. Mở lại panel trong cùng trang có thể lấy lại bản ghi Undo còn hợp lệ nằm trong trang.
- Nếu CVAT còn đủ action, tool Undo đúng số action rồi audit toàn bộ export trước sửa. Nếu đợt dài vượt lịch sử giới hạn, tool khôi phục points gốc và chỉ bỏ keyframe do đợt Apply đó thêm, qua native state trên chính track cũ.
- Cách khôi phục dự phòng có thể để lại dấu nguồn đã chỉnh của CVAT; tool báo rõ.
- **Ctrl+Z native có thể chỉ hoàn tác một frame**, không phải toàn đợt.
- Thao tác sửa/Save/Undo/Redo tiếp theo có thể làm snapshot khôi phục hết khớp. Tool từ chối ghi đè dữ liệu mới.
- Phần thay đổi giữa chừng đã xác minh có thể cho phép hoàn tác chủ động. Audit ID/nội dung không khớp thì khóa khôi phục thay vì đoán trạng thái để ghi đè. Giữ log và dừng Apply.
- Backup là dữ liệu phục vụ khôi phục, **không phải nút import/restore cả job một lần**. Reload CVAT không tái tạo lịch sử Undo cũ trong bộ nhớ.

## Các file xuất và dữ liệu riêng tư

| Nút                            | Nội dung / mục đích                                                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Tải báo cáo phân tích**      | Cấu hình, tư thế, kiểm tra chấp nhận/ràng buộc và quyết định theo frame; không có tọa độ crop nên không đủ tái chạy phép tính point cloud |
| **Tải chẩn đoán có điểm crop** | Crop giới hạn, mask và cấu hình để replay cục bộ; không phải toàn bộ PCD                                                                  |
| **Tải snapshot dựng hình**     | Bề mặt tái dựng, nguồn quan sát và lựa chọn xem/box chung; chưa có nhập snapshot vào UI                                                   |
| **Tải backup trước Apply**     | Snapshot annotation đầy đủ trước một lượt Apply, có thể gồm sửa chưa Save                                                                 |
| **Tải lịch sử backup/audit**   | Backup/journal từng lượt, snapshot phiên hiện tại và kết quả/lỗi kiểm tra chỉ đọc của job hiện tại                                        |

Tọa độ điểm, nhãn và dữ liệu khôi phục có thể là thông tin riêng tư. File recovery có cả ngữ cảnh job/host. Chỉ tải file khi người dùng bấm; extension không tự upload lên GitHub, dịch vụ khác hoặc model ngoài. Source và demo không chứa annotation/point cloud thật riêng tư.

GET cùng origin dùng phiên đăng nhập CVAT trong trình duyệt; không cần dán token vào tool. Quyền trình duyệt gồm `activeTab`, `scripting`, `storage`. Không có dịch vụ suy luận, endpoint telemetry, CDN hoặc tải package runtime. Backup nằm trong profile/storage extension hiện tại, không tự chia sẻ giữa máy.

Replay chẩn đoán cục bộ:

```sh
node scripts/replay.mjs /path/to/track-refiner-crop-diagnostic.json > replay-report.json
```

## Xử lý lỗi thường gặp

| Hiện tượng                                                    | Ý nghĩa và hướng xử lý                                                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Không tìm thấy phiên CVAT                                     | Mở đúng job 3D và bảng Objects, chờ tải xong rồi mở tool từ tab đó. Host tùy biến có thể không cung cấp store/native API tương thích.                                                                 |
| API 404 / không tải được PCD hoặc ID annotation               | Reverse proxy có thể dùng đường API khác. Trong tùy chọn, thử đường cùng origin thực tế, ví dụ `/api` hoặc `/cvat/api`; URL ngoài bị từ chối. Frame cần là PCD hỗ trợ, không phải HTML, ảnh hoặc ZIP. |
| Tab đã đổi job / reload                                       | Đọc job lại. Đề xuất cũ gắn với tab/job/document gốc.                                                                                                                                                 |
| Frame không khớp keyframe native/baseline                     | Annotation đã đổi hoặc adapter không xác minh được. Đọc/Phân tích lại; không sửa ID để ép Apply.                                                                                                      |
| ID/thứ tự server lệch, client bị khuyết, object mới chưa Save | Chỉ xem trước trong trạng thái đó. Xuất log recovery và đối chiếu bản đồ ID. Không bấm Save chỉ để vượt cảnh báo chưa hiểu.                                                                           |
| Lượt prepared/partial/quarantined chặn Apply                  | Lượt trước chưa được xác nhận. Không Apply lặp; dùng Undo chủ động nếu còn được cung cấp hoặc giữ log để điều tra. Mở lại panel không xóa chốt.                                                       |
| Quota storage / không đọc lại được backup                     | Không gửi Apply mới. Xuất các bản recovery hiện có trước khi cân nhắc xử lý storage; tool không tự xoay vòng xóa backup.                                                                              |
| Frame chưa xác định / chỉ thấy một mặt hoặc điểm quá thưa     | Bổ sung quan sát chồng lấp hoặc xem lại mốc/crop. Thiếu ràng buộc hình học không thể giải quyết chỉ bằng nới box.                                                                                     |
| Box ôm gương hoặc thiếu phía thân xa                          | Lõi chưa có model ngữ nghĩa thân/gương hoặc dựng phần khuất. Kiểm tra box chung qua nhiều frame và theo quy tắc gán nhãn.                                                                             |
| Apply thành công nhưng nội dung server khác phiên             | Có thể còn sửa chưa Save hoặc khác biệt tuần tự hóa. Xem trạng thái Save của CVAT rồi kiểm tra chỉ đọc; nút không ép Save hay khôi phục.                                                              |
| ID đã bị bản cũ đổi                                           | Dừng Apply, giữ backup gốc/export hiện tại và điều tra riêng. Cài bản này không trả ID cũ lại.                                                                                                        |

## Giới hạn và chất lượng

- Dạng hỗ trợ là cuboid track 3D gần thẳng đứng của vật cứng, biểu diễn bằng 16 giá trị points CVAT. Giữ roll/pitch gốc; từ chối độ nghiêng không hỗ trợ. Người biến dạng, xe khớp nối và loại object tùy ý không nằm trong phạm vi mục tiêu.
- Căn cục bộ từ pre-label gần đúng, tinh chỉnh dịch và yaw; chưa có ego-motion đầy đủ, global pose graph, tối ưu roll/pitch hoặc deskew scan. Không tự giải mơ hồ đầu/đuôi 180°.
- Bề mặt là quan sát có nguồn, không phải mesh kín hay xe được suy hoàn chỉnh. Vùng chưa từng thấy chưa được đo; không có điểm không đồng nghĩa không gian trống đã được xác nhận.
- Vật chạm nhau, nhiễu dính thân, sai tracking ID, khởi tạo kém, mặt đất dốc, méo do chuyển động, điểm thưa hoặc nhiễu lặp lại vẫn có thể làm sai kết quả.
- Residual/support/ràng buộc nội bộ không phải ground truth chuyên gia. Hình ghép đẹp, nhiều điểm hơn hoặc residual thấp không chứng minh nhãn tốt hơn pre-label gốc.
- Khoảng Apply tối đa 1200 frame. Tải PCD tối đa 32 MiB/frame, đầu vào giải mã tối đa 2 triệu điểm/frame, giải nén tối đa 128 MiB. Worker giữ crop giới hạn đã lấy mẫu. Job lớn và audit toàn annotation sau mỗi frame vẫn có thể tốn tài nguyên.
- Draft có thể thêm keyframe dày; chưa có rút gọn keyframe. Frame giữa các mẫu được hỗ trợ có thể nhận nội suy giới hạn, chưa được kiểm chứng bằng point cloud riêng.
- Bộ fit cũ có heuristic theo thời gian/biên/coverage riêng, vẫn có thể sai khi căn hoặc chọn điểm sai. Xem [VALIDATION.md](VALIDATION.md) về phản ví dụ đã kiểm tra và phần chưa xác minh.

Trước khi tin một hệ thống sửa tự động, cần đối chiếu độc lập pre-label gốc và đề xuất với nhãn chuẩn được chuyên gia duyệt, gồm số ca sai thành đúng, đúng thành sai và thời gian review. Dự án chưa chứng minh được lợi thế chất lượng đó trên dữ liệu thật.

## Phát triển và kiểm chứng

Source dùng ES modules, comment tiếng Anh, Canvas2D và Web Worker; extension không có runtime dependencies. UI tiếng Việt; hai README mô tả cùng hành vi v0.3.2. Không cần đường tuyệt đối theo máy, ID tài khoản hoặc hostname CVAT khóa cứng để dùng tool.

```text
extension/cvat/           Adapter native, chốt ID và ranh giới ghi có journal
extension/core/           Hệ tọa độ, nội suy, tạo draft và diagnostics
extension/reconstruction/ Căn bề mặt, ràng buộc, hợp nhất và chiếu box chung
extension/pointcloud/     Giải mã PCD/LZF, crop giới hạn và lấy mẫu
extension/fitting/        Bộ fit box cũ và kiểm tra bằng chứng riêng
extension/workers/        Tính ngoài luồng chính; phân tích không có API sửa
extension/ui/             Preview, viewer truy nguồn và điều khiển box chung
extension/demo/           Dữ liệu tổng hợp có kiểm soát
tests/                   Contract adapter/transaction/import, hình học và worker thật
scripts/                 Test, đóng gói, replay chẩn đoán và phát hành
releases/                Ghi chú từng bản, source commit và danh sách asset
release-assets/          Các ZIP/checksum gốc được giữ theo version
```

Dùng Node.js từ 20 để phát triển; CI dùng Node.js 22. Python 3 chỉ cần để đóng gói hoặc chạy HTTP demo tùy chọn, không cần trên máy người dùng extension.

```sh
node scripts/test.mjs
python3 scripts/build.py
```

Builder ghi ZIP extension/source và `SHA256SUMS` vào `dist/`. Các gói đóng từ source hiện tại về sau sẽ có cả hai README. Asset release gốc đã xuất bản được giữ nguyên. Không commit export CVAT thật, point cloud, thông tin đăng nhập hoặc backup vào repo Public này.

Để chạy demo UI cục bộ:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory extension
```

Mở `http://127.0.0.1:8765/panel.html` rồi chọn mẫu. Đọc/Apply job CVAT thật cần extension đã cài và tab CVAT tương thích. Có thể format source tùy chọn bằng `npx prettier@3.6.2 --write extension tests`.

**Kiểm chứng implementation v0.3.2:** 96 tests tự động đã qua, gồm ID native tại chỗ, mô phỏng lỗi nhãn khác/thứ tự, journal bền vững, 80 object qua Save/reload mô phỏng và phương thức import lấy từ source CVAT chính thức để kiểm thử. Factory model và fixture server/native là mô phỏng. Kiểm tra browser trước đó chạy worker/viewer thật trên dữ liệu tổng hợp, không chứng nhận cài Brave thật hay Save/Undo của host người dùng. Xem [VALIDATION.md](VALIDATION.md) về bằng chứng và phần chưa xác minh. Cập nhật tài liệu không thiết lập tương thích host hoặc độ chính xác mới.

## Giấy phép và nguồn tham khảo

MIT. Xem [LICENSE](LICENSE), [NOTICE.md](NOTICE.md) và [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).

Các pattern adapter/refresh và PCD ban đầu được phát triển có tham khảo [prelabelcheck_CVAT](https://github.com/thanhdanh11-test/prelabelcheck_CVAT), source commit `0c6246c03704c142c27cddf9df4b9be2f3d7522b`, giữ thông báo MIT. Từ v0.3.1, writer thay track qua Commit đã bị bỏ. Phương thức import CVAT chính thức chỉ nằm trong fixture kiểm thử có ghi nguồn, không phải runtime CVAT đi kèm. Không phân phối weights model nghiên cứu hoặc dataset riêng tư.

Đây là dự án độc lập, không phải sản phẩm CVAT chính thức. Source commit chính xác từng bản nằm trong [releases/index.json](releases/index.json); các commit lịch sử được nhập khi chuẩn bị repo, không giả lập ngày phát triển cũ.
