<?php header(   "Cache-Control: no-cache, no-store, must-revalidate"); header("Pragma: no-cache"); header("Expires: 0"); header("Content-type: text/html; charset=utf-8"); // Proxies.
	$time=microtime(); $time=explode(' ',$time ); $time=$time[1]+$time[0]; $start=$time; 
	unset( $_POST, $_GET );
	@include_once 'inc/arrays.php'; @include_once 'inc/funcs.php'; @include_once 'inc/pre.php'; 
	?><!doctype html><html lang="en">

<?php echo $view_source_top; ?>

<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Slant Finder.Pro</title><meta name="description" content="Slant Finder.Pro - Fretboard Visualization Tool, Chord Builder, and Tuning Database"><meta property="og:title" content="Slant Finder.Pro"><meta property="og:type" content="website"><meta property="og:url" content="https://slantfinder.pro/"><meta property="og:description" content="Slant Finder.Pro - Fretboard Visualization Tool, Chord Builder, and Tuning Database"><link rel="icon" href="img/favicon.ico"><link rel="icon" href="img/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="img/apple-touch-icon.png"><script src="https://code.jquery.com/jquery-1.10.2.js"></script><script src = "https://code.jquery.com/ui/1.10.4/jquery-ui.js"></script><link rel="stylesheet" href="inc/stylee.css.php<?php echo "?id=".rand(1111,9999); ?>"> <script src="inc/steel.js"></script></head>
<!--/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////--><body>
<div id="section_1"><h1><a href="<?php echo $self; ?>"><span class="slant">Slant</span><span class="finder">Finder</span><span class="pro">.pro</span></a></h1><?php @include_once 'inc/options.php'; ?><br/></div>
<div id="section_2"><br/><?php @include_once 'inc/fretboard.php'; ?><br/></div>
<div id="section_3"><br/><?php @include_once 'inc/chord_grid.php'; ?><br/></div>
<div id="section_4"><br/><?php @include_once 'inc/keyboard.php'; ?><br/></div>
<div id="section_5"><br/><?php @include_once 'inc/tunings.php'; ?><br/></div>
<!--////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

<?php 
$spcr = ","; 
foreach ( $tunings as $tkey => $tval ) {
	echo $tunings[$tkey]['strs']."-String";
	echo $spcr;
	echo $tunings[$tkey]['name'];
	echo $spcr;
	echo $tunings[$tkey]['notes'];
	echo $spcr;
	echo $tunings[$tkey]['dgs'];
	echo $spcr;
	echo "
";
}
echo "

";
foreach ( $tunings as $tkey => $tval ) {
	echo $tunings[$tkey]['strs']."-String";
	echo $spcr;
	echo $tunings[$tkey]['name'];
	echo $spcr;
	echo str_replace( " ", "", $tunings[$tkey]['notes'] );
	echo $spcr;
	echo str_replace( " ", "", $tunings[$tkey]['dgs'] );
	echo $spcr;
	echo "
";
}
?>

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////-->
<div id="blurb">Loaded in <?php $time = microtime();$time = explode(' ', $time);$time = $time[1] + $time[0];$finish = $time;$total_time = round(($finish - $start), 8);echo $total_time . "s"; 
	unset( 	$_0, $_1, $_1_, $_2_, $_3_, $_4_, $_5_, $_6_, $_7_, $_GET, $_POST, $_b2_, $_b3_, $_b5_, $_b6_, $_b7_, $_id_, $a, 
			$add_url, $allnotes, $b, $bot, $bot_ips, $c, $cb, $checked, $checkers, $chords, $city, $country, $def, $def_x, $degrees, 
			$errors, $extensions, $f_cyo, $fb_id, $finish, $fretnums, $headers, $hilight_url, $hl, $i, $id_x, $ip, $ipaddress, $ips_x, 
			$json, $k, $key, $keys, $msg, $n, $name, $note, $notedegrees, $notesplode, $now, $nut1, $nut_id, $o, $p, $q, $q_arr, 
			$red_, $red_bg, $red_bg_, $region, $rev, $s, $scales, $sdgs, $search, $self, $start, $str, $strizzle, $sub, $svr_ip, $the_1, 
			$the_url, $this_url, $time, $time, $total_time, $to, $total_time, $tun_url, $tunin, $tunings, $url_arr, $url_base, $url_check, 
			$url_hl, $url_note_check, $url_path_arr, $url_query_arr, $url_s, $v, $value, $varray, $x, $z, $a, $b, $c, $d, $e, $f, $g, $h, $i );
	?></div><script>function viewSource(){;var source = "<html>";source += document.getElementsByTagName('html')[0].innerHTML;source += "</html>";source = source.replace(/</g, "&lt;").replace(/>/g, "&gt;");source = "<pre>"+source+"</pre>";sourceWindow = window.open('','Source of page','height=800,width=1000,scrollbars=1,resizable=1,bg=yellow');sourceWindow.document.write(source);sourceWindow.document.close(); if(window.focus) sourceWindow.focus();}  </script></body></html>