# Dùng lõi dựng hình v0.3.2

Đây là bản thử đầu của lõi độc lập với box. Nó căn và giữ các bề mặt **quan sát được**, chưa nhận dạng thân xe/phụ kiện và chưa hoàn thiện phần bị khuất. Không dùng độ đẹp của hình ghép để thay việc kiểm tra từng frame.

## Bắt đầu

1. Cài ZIP `brave` bằng Load unpacked. Mở tool từ biểu tượng trên tab job CVAT; không cần reload CVAT để chạy phân tích/Apply.
2. Chọn object, kết thúc thao tác đang kéo trong CVAT rồi bấm **Đọc job / object đang chọn**. Thay đổi chưa Save vẫn được đọc.
3. Giữ chế độ **Lõi dựng hình + box chung**, chọn khoảng và số frame mẫu. Mặc định 24, tối đa 48. Đây là ngân sách quan sát; không có nghĩa mọi frame trong khoảng đều đã được kiểm tra bằng điểm riêng.
4. Bấm **Phân tích**. Lõi dùng pre-label để khởi tạo hệ tọa độ/vùng tìm; không lấy rìa đám điểm để tạo kích thước box.
5. Muốn xem trước mà chưa dùng dữ liệu thật, bấm **Thử dữ liệu mẫu** rồi Phân tích. Mẫu có thân cong, tư thế pre-label lệch và một phần nhô chỉ xuất hiện ở một frame. Apply luôn bị khóa ở chế độ mẫu.

## Kiểm tra hình ghép

- Kéo trong hình 3D để xoay, cuộn để phóng to/thu nhỏ. Có thanh góc ngang/góc cao và nút đặt lại.
- Chọn **Màu theo** nguồn frame, số frame hỗ trợ hoặc độ phân tán. Vàng ở chế độ hỗ trợ nghĩa là một frame quan sát, không tự động là nhiễu.
- Bấm điểm trong hình 3D để xem vùng và những frame đóng góp. ID điểm là ID trong crop/ô bề mặt, không phải chỉ số điểm của PCD gốc.
- Ba hình chiếu X/Y, X/Z và Y/Z dùng cùng hệ vật thể, giúp so các frame trong cùng trục.
- **Quan sát → Frame …** cho thấy điểm của frame đó sau biến đổi về hệ chung. Frame chưa xác định vẫn xem được, nhưng không góp vào bề mặt chung mặc định.
- Checkbox trong bảng chỉ đổi hiển thị; đóng góp của frame bị ẩn được bỏ khỏi các tâm ô đang hiển thị. Nó không đổi kết quả căn hoặc phạm vi Apply.
- **Loại / nhận lại frame chọn** dựng lại từ crop đang giữ, bỏ frame đó khỏi căn ghép/hợp nhất. Dữ liệu quan sát vẫn được giữ để kiểm tra và xuất chẩn đoán.
- **Chọn làm mốc** cố định hệ chung theo pre-label của frame chọn. **Ghim / bỏ ghim theo pre-label** cho phép giữ thêm tư thế bạn tin cậy. Mốc là giả định/anchor, không phải bằng chứng rằng pre-label đã đúng. Muốn sửa anchor, chỉnh trong CVAT rồi Đọc và phân tích lại.
- Đổi mốc hoặc dựng lại sẽ hủy đề xuất box chung và khởi tạo lại editor; không âm thầm dùng box từ một hệ tọa độ cũ.

**4/4** trong bảng nghĩa là các hướng dịch X/Y/Z và yaw được hệ phương trình khớp bề mặt hỗ trợ theo ngưỡng hiện tại. Đây không phải xác suất đúng hoặc chứng nhận đạt sai số. Mặt phẳng đơn, nhóm không nối được về mốc hoặc điểm kiểm tra không khớp sẽ hiện **Chưa xác định**.

Các dấu hiệu mặt đất/box object khác chỉ là mask ngữ cảnh. Chúng không được dùng để căn, nhưng crop vẫn giữ chúng và có thể bật xem màu xám. Phần nằm ngoài vùng crop/lấy mẫu không được giữ lại; nếu crop thiếu, tăng vùng tìm hoặc đọc lại khoảng phù hợp.

## Chỉnh box chung (tùy chọn)

Lõi dựng hình có thể được dùng mà không tạo box.

1. Mở **Box chung chỉnh tay**. Giá trị ban đầu lấy từ pre-label của mốc; chưa phải đo đạc mới.
2. Bật **Hiện box chung**; chỉnh tâm X/Y/Z, yaw, dài/rộng/cao bằng ô số. Bản này chưa có tay nắm kéo trực tiếp các mặt box.
3. Xem các hình chiếu và frame riêng. Lõi chưa biết gương có thuộc mục tiêu hay không; người dùng quyết định box cần ôm vùng nào.
4. Bấm **Tạo đề xuất từ box tôi chỉnh**. Chỉ lúc này mới có draft cho Apply. Chỉnh tiếp bất kỳ giá trị nào sẽ hủy draft trước đó.
5. Đọc số frame thay đổi/keyframe thêm và số frame nội suy. Kích thước box dùng chung, còn tâm/yaw được biến đổi theo từng frame đã căn. Frame chưa xác định và các khoảng đi qua mẫu bị giữ lại sẽ giữ nguyên hình học.
6. **Apply vào CVAT** sửa từng native ObjectState trên track hiện có. Kiểm tra giữ clientID, ID server track và ID keyframe cũ; đồng thời audit các annotation khác. Không tự Save, không gọi API ghi annotation, không yêu cầu reload. Auto save của CVAT vẫn có thể lưu sau Apply; tool không đổi cài đặt này.
7. Kiểm tra bằng Next. Nút **Hoàn tác Apply gần nhất** của tool trả lại toàn đợt khi snapshot và lịch sử vẫn khớp. Nó dùng native Undo đủ số action nếu còn đầy đủ lịch sử; với đợt dài đã vượt lịch sử CVAT, nó khôi phục points của keyframe cũ và xóa riêng keyframe do Apply thêm. Giữ nguyên track/ID; không import hoặc xóa/tạo lại object.
8. Ctrl+Z gốc của CVAT có thể chỉ trả lại một frame; không coi đó là hoàn tác toàn đợt. Native Save/Undo/Redo sau thao tác khác có thể làm snapshot không còn khớp, khi đó tool từ chối khôi phục đè.
9. CVAT có thể đổi `source` từ auto sang semi-auto hoặc file sang manual khi chỉnh. Nếu phải khôi phục bằng points vì lịch sử đã thiếu, hình học/keyframe được trả lại nhưng dấu nguồn đã chỉnh có thể còn; tool báo rõ. Nó không sửa nguồn bằng API riêng hoặc ghi đè cả job.
10. Nếu Apply lỗi giữa chừng, không bấm Apply lặp. Khi audit xác minh được phần đã thay đổi, tool cho hoàn tác chủ động; nếu audit không khớp thì dừng và giữ backup để kiểm tra.

Box được chọn phải nằm trong giới hạn dịch/xoay và tỷ lệ kích thước của từng frame liên quan. Nếu vượt giới hạn, tool báo rõ frame; không âm thầm cắt bớt giá trị bạn nhập.

## Lưu để kiểm tra lại

- **Tải báo cáo phân tích:** các tư thế, rank, sai lệch/support trên điểm kiểm tra, cấu hình và trạng thái.
- **Tải chẩn đoán có điểm crop:** crop giới hạn, masks và cấu hình để tái chạy lõi bằng `node scripts/replay.mjs FILE.json`.
- **Tải snapshot dựng hình:** thêm bề mặt đã hợp nhất và lựa chọn xem/box chung. Bản đầu xuất snapshot và hỗ trợ replay bằng CLI; chưa có chức năng nhập snapshot vào UI.

Các file chứa tọa độ là dữ liệu job. Chúng chỉ được lưu về máy khi bạn bấm, không tự upload. Không commit chúng vào repository Public. Không chứa cookie/token hay URL job trong định dạng xuất của tool.

## Giới hạn của mốc đầu

- Căn cục bộ từ pre-label gần đúng, chỉ tối ưu ba hướng dịch và yaw; không có global pose graph hoàn chỉnh, tối ưu roll/pitch, deskew hoặc shape completion.
- Bề mặt là các mẫu có pháp tuyến/provenance; không phải mesh kín và chưa có mô hình phân loại thân xe, gương hay nền.
- Không xem vùng không có điểm là không gian trống đã được đo; không suy ra chuyển động thế giới khi thiếu ego-motion.
- Điểm fit/kiểm tra là các tập chỉ số khác nhau trong cùng scan. Đây là kiểm tra nội bộ, không phải đánh giá độc lập độ chính xác trên dữ liệu thật.
- Frame ở giữa hai mẫu căn được có thể nhận nội suy trong draft; chưa được xem như đã tái dựng/kiểm chứng trực tiếp.
- Giữ **Bộ fit box cũ (đối chiếu)** riêng để so sánh. Chế độ này vẫn có các giới hạn lấy biên đã ghi nhận.

## Bảo vệ ID và log v0.3.2

Trước Apply phải đọc được annotation server và xác minh ID/thứ tự. Chưa Save object mới, ID phiên bị khuyết/đổi thứ tự, thiếu quyền GET, storage đầy hoặc có lượt lỗi chưa xác minh đều chặn ghi; phân tích/xem trước vẫn dùng được. Không bấm Save chỉ để vượt chốt khi chưa hiểu thông báo.

Mỗi frame được audit đầy đủ ngay sau sửa. Sau Save/Auto save, bấm **Kiểm tra ID sau Save (chỉ đọc)**. Nút chỉ GET và đọc phiên/storage; không thử sửa nhãn để kiểm tra. Thông báo Apply thành công chỉ xác nhận kiểm tra tại thời điểm đó. Không bảo đảm cho hành vi tương lai của host tùy biến.

**Tải lịch sử backup/audit** dùng được sau mở lại panel: các snapshot/log từng lượt không bị tự ghi đè. File này chứa annotation và URL/ngữ cảnh job; giữ riêng, không đưa lên repo Public. Nếu update, chép bản mới vào đúng thư mục cũ và Reload **extension**, giữ nguyên ID/storage; không gỡ cài đặt hoặc Load unpacked từ thư mục khác. Xem README.

Bản này không sửa lại ID đã mất trong sự cố trước. Không tự import backup và không tự ghi đè toàn bộ job để khôi phục.
