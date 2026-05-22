

import Download from '../components/icons/download.vue'
import Pencil from '../components/icons/pencil.vue'
import Feedlist from '../components/icons/feedlist.vue'
import Transfer from '../components/icons/transfer.vue'
import Trash from '../components/icons/trash.vue'
import Add from '../components/icons/add.vue'
import Gear from '../components/icons/gear.vue'
import Chevron from '../components/icons/chevron.vue'
import Close from '../components/icons/close.vue'
import Upload from '../components/icons/upload.vue'
import Save from '../components/icons/save.vue'
import Text from '../components/icons/text.vue'
import Number from '../components/icons/number.vue'
import Calendar from '../components/icons/calendar.vue'
import Mail from '../components/icons/mail.vue'
import Select from '../components/icons/select.vue'
import Password from '../components/icons/password.vue'
import Checkbox from '../components/icons/checkbox.vue'
import Textarea from '../components/icons/textarea.vue'
import Radio from '../components/icons/radio.vue'
import Construction from '../components/icons/construction.vue'
import Folder from '../components/icons/folder.vue'
import Link from '../components/icons/link.vue'
import Clipboard from '../components/icons/clipboard.vue'
import Cube from '../components/icons/cube.vue'
import Folders from '../components/icons/folders.vue'
import Edit from '../components/icons/edit.vue'
import Checkmark from '../components/icons/checkmark.vue'
import Arrow from '../components/icons/arrow.vue'
import EditBox from '../components/icons/editBox.vue'
import Copy from '../components/icons/copy.vue'
import User from '../components/icons/user.vue'
import DocCheck from '../components/icons/docCheck.vue'
import CloudUpload from '../components/icons/cloudUpload.vue'
import Eye from '../components/icons/eye.vue'
import Document from '../components/icons/document.vue'
import Return from '../components/icons/return.vue'
import Deny from '../components/icons/deny.vue'
import Request from '../components/icons/request.vue'
import History from '../components/icons/history.vue'
import SaveChanges from '../components/icons/saveChanges.vue'
import Comment from '../components/icons/comment.vue'
import Send from '../components/icons/send.vue'
import FloatingInSpace from '../components/icons/floatingInSpace.vue'
import Mailbox from '../components/icons/mailbox.vue'
import Bell from '../components/icons/bell.vue'
import Users from '../components/icons/users.vue'
import Question from '../components/icons/question.vue'
import Lock from '../components/icons/lock.vue'
import ThumbsUp from '../components/icons/thumbsUp.vue'
import Metrics from '../components/icons/metrics.vue'
import CommentSolid from '../components/icons/commentSolid.vue'
import Book from '../components/icons/book.vue'

const icons = {
	'add' : Add,
	'close' : Close,
	'edit' : Edit,
	'download' : Download,
	'pencil' : Pencil,
	'feedlist' : Feedlist,
	'transfer' : Transfer,
	'trash' : Trash,
	'gear' : Gear,
	'chevron' : Chevron,
	'upload' : Upload,
	'file' : Folder,
	'save' : Save,
	'text' : Text,
	'number' : Number,
	'Date' : Calendar,
	'email' : Mail,
	'select' : Select,
	'password' : Password,
	'checkbox' : Checkbox,
	'textarea' : Textarea,
	'radio' : Radio,
	'construction' : Construction,
	'folder' : Folder,
	'link' : Link,
	'clipboard' : Clipboard,
	'cube' : Cube,
	'folders' : Folders,
	'checkmark' : Checkmark,
	'arrow' : Arrow,
	'editBox' : EditBox,
	'copy' : Copy,
	'user' : User,
	'docCheck' : DocCheck,
	'cloudUpload' : CloudUpload,
	'eye' : Eye,
	'document' : Document,
	'return' : Return,
	'deny' : Deny,
	'request' : Request,
	'history' : History,
	'saveChanges' : SaveChanges,
	'comment' : Comment,
	'send' : Send,
	'floatingInSpace' : FloatingInSpace,
	'mailbox' : Mailbox,
	'bell' : Bell,
	'users' : Users,
	'question' : Question,
	'lock' : Lock,
	'thumbsUp' : ThumbsUp,
	'metrics' : Metrics,
	'commentSolid' : CommentSolid,
	'book' : Book
}




export function getIcon(name) {
	return icons[name]
}
